use bevy_ecs::prelude::*;
use uuid::Uuid;

use crate::content::NpcScheduleContent;
use crate::protocol::PlayerId;

use super::model::{
    point_from_position, NpcPartyEvent, NpcRelocatedEvent, Position, SimWorld, Velocity,
    FOLLOW_DISTANCE, NPC_SPEED, TALK_RADIUS,
};
use super::movement::distance;

const TICKS_PER_SECOND: u64 = 20;
/// Cognition-owned invites that nothing resolved (e.g. the model answered
/// with speech instead of a party verb) decline after this long so the NPC
/// never stays stuck in the Invited state.
const INVITE_DECISION_TIMEOUT_TICKS: u64 = 60 * TICKS_PER_SECOND;

#[derive(Component, Debug, Clone)]
pub(super) struct Npc {
    pub(super) id: String,
    pub(super) persona_id: String,
    pub(super) name: String,
    pub(super) radius: f32,
    pub(super) schedule: Vec<NpcScheduleContent>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum NpcPartyState {
    Invited {
        player_id: PlayerId,
        invite_id: Uuid,
        at_tick: u64,
    },
    InParty {
        player_id: PlayerId,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NpcPartyError {
    UnknownNpc,
    UnknownPlayer,
    OutOfRange,
    NpcBusy,
    PlayerBusy,
    NotInParty,
}

impl NpcPartyError {
    pub fn as_log_reason(&self) -> String {
        match self {
            NpcPartyError::UnknownNpc => "party_unknown_npc",
            NpcPartyError::UnknownPlayer => "party_unknown_player",
            NpcPartyError::OutOfRange => "party_out_of_range",
            NpcPartyError::NpcBusy => "party_npc_busy",
            NpcPartyError::PlayerBusy => "party_player_busy",
            NpcPartyError::NotInParty => "party_not_in_party",
        }
        .to_string()
    }
}

#[derive(Debug, Clone, Copy)]
pub struct NpcPartyInvite {
    pub invite_id: Uuid,
}

impl SimWorld {
    pub fn invite_npc_to_party(
        &mut self,
        player_id: PlayerId,
        npc_id: &str,
    ) -> Result<NpcPartyInvite, NpcPartyError> {
        let npc_entity = *self
            .npc_entities
            .get(npc_id)
            .ok_or(NpcPartyError::UnknownNpc)?;
        let player_entity = *self
            .players
            .get(&player_id)
            .ok_or(NpcPartyError::UnknownPlayer)?;
        if self.npc_parties.contains_key(npc_id) {
            return Err(NpcPartyError::NpcBusy);
        }
        if self.player_party.contains_key(&player_id) {
            return Err(NpcPartyError::PlayerBusy);
        }
        let npc_position = self
            .world
            .get::<Position>(npc_entity)
            .copied()
            .ok_or(NpcPartyError::UnknownNpc)?;
        let player_position = self
            .world
            .get::<Position>(player_entity)
            .copied()
            .ok_or(NpcPartyError::UnknownPlayer)?;
        if distance(npc_position, player_position) > TALK_RADIUS {
            return Err(NpcPartyError::OutOfRange);
        }
        let invite_id = Uuid::new_v4();
        self.npc_parties.insert(
            npc_id.to_string(),
            NpcPartyState::Invited {
                player_id,
                invite_id,
                at_tick: self.tick,
            },
        );
        Ok(NpcPartyInvite { invite_id })
    }

    pub fn leave_npc_party(
        &mut self,
        player_id: PlayerId,
        npc_id: &str,
    ) -> Result<(), NpcPartyError> {
        if !self.npc_entities.contains_key(npc_id) {
            return Err(NpcPartyError::UnknownNpc);
        }
        match self.npc_parties.get(npc_id) {
            Some(NpcPartyState::InParty {
                player_id: leader_id,
            }) if *leader_id == player_id => {
                self.dissolve_npc_party(npc_id);
                Ok(())
            }
            Some(NpcPartyState::Invited {
                player_id: leader_id,
                ..
            }) if *leader_id == player_id => {
                self.dissolve_npc_party(npc_id);
                Ok(())
            }
            _ => Err(NpcPartyError::NotInParty),
        }
    }

    /// Resolves an NPC's pending party invite. `accept: true` joins the party.
    /// Deterministic auto-accept calls this from the tick; the cognition engine
    /// calls it through the intent pump once it owns the decision.
    pub fn resolve_npc_party_invite(
        &mut self,
        npc_id: &str,
        accept: bool,
    ) -> Option<NpcPartyEvent> {
        let Some(NpcPartyState::Invited {
            player_id,
            invite_id,
            ..
        }) = self.npc_parties.get(npc_id).copied()
        else {
            return None;
        };
        if accept && self.players.contains_key(&player_id) {
            self.npc_parties
                .insert(npc_id.to_string(), NpcPartyState::InParty { player_id });
            self.player_party.insert(player_id, npc_id.to_string());
            Some(NpcPartyEvent::Joined {
                player_id,
                npc_id: npc_id.to_string(),
            })
        } else {
            self.npc_parties.remove(npc_id);
            Some(NpcPartyEvent::Declined {
                player_id,
                npc_id: npc_id.to_string(),
                invite_id,
            })
        }
    }

    pub(super) fn dissolve_npc_party(&mut self, npc_id: &str) {
        if let Some(state) = self.npc_parties.remove(npc_id) {
            let player_id = match state {
                NpcPartyState::Invited { player_id, .. } => player_id,
                NpcPartyState::InParty { player_id } => player_id,
            };
            self.player_party.remove(&player_id);
        }
        if let Some(entity) = self.npc_entities.get(npc_id) {
            if let Some(mut velocity) = self.world.get_mut::<Velocity>(*entity) {
                velocity.x = 0.0;
                velocity.y = 0.0;
            }
        }
    }

    pub(super) fn dissolve_parties_for_player(&mut self, player_id: PlayerId) {
        let npc_ids: Vec<String> = self
            .npc_parties
            .iter()
            .filter_map(|(npc_id, state)| {
                let leader = match state {
                    NpcPartyState::Invited { player_id, .. } => *player_id,
                    NpcPartyState::InParty { player_id } => *player_id,
                };
                (leader == player_id).then(|| npc_id.clone())
            })
            .collect();
        for npc_id in npc_ids {
            self.dissolve_npc_party(&npc_id);
        }
    }

    /// Deterministic engine-off behavior (also the permanent fallback):
    /// pending invites auto-accept one tick after they arrive. When the
    /// cognition engine owns invite decisions the game disables this and
    /// resolves invites through the intent pump instead.
    pub(super) fn auto_accept_pending_invites(&mut self) -> Vec<NpcPartyEvent> {
        let deterministic = self.npc_invites_deterministic;
        let pending: Vec<(String, bool)> = self
            .npc_parties
            .iter()
            .filter_map(|(npc_id, state)| match state {
                NpcPartyState::Invited { at_tick, .. } if deterministic && *at_tick < self.tick => {
                    Some((npc_id.clone(), true))
                }
                // Engine-owned invites: decline after the decision timeout so
                // an unresolved invite can never strand the NPC.
                NpcPartyState::Invited { at_tick, .. }
                    if !deterministic
                        && at_tick.saturating_add(INVITE_DECISION_TIMEOUT_TICKS) < self.tick =>
                {
                    Some((npc_id.clone(), false))
                }
                _ => None,
            })
            .collect();
        pending
            .into_iter()
            .filter_map(|(npc_id, accept)| self.resolve_npc_party_invite(&npc_id, accept))
            .collect()
    }

    /// Writes NPC velocities: follow the party leader when beyond FOLLOW_DISTANCE,
    /// stand still otherwise. Followers that fall too far behind (stuck on an
    /// obstacle, outrun) blink to the leader's side instead of silently
    /// dropping out of the player's interest radius. Runs before the generic
    /// movers loop each tick; returns the catch-up teleports for journaling.
    pub(super) fn steer_party_npcs(&mut self) -> Vec<NpcRelocatedEvent> {
        const CATCHUP_DISTANCE: f32 = 350.0;
        const CATCHUP_OFFSET: f32 = 48.0;

        let follows: Vec<(Entity, String, Option<Position>)> = self
            .npc_parties
            .iter()
            .filter_map(|(npc_id, state)| {
                let NpcPartyState::InParty { player_id } = state else {
                    return None;
                };
                let npc_entity = *self.npc_entities.get(npc_id)?;
                let leader = self
                    .players
                    .get(player_id)
                    .and_then(|entity| self.world.get::<Position>(*entity).copied());
                Some((npc_entity, npc_id.clone(), leader))
            })
            .collect();
        let mut catchups = Vec::new();
        for (npc_entity, npc_id, leader) in follows {
            let Some(npc_position) = self.world.get::<Position>(npc_entity).copied() else {
                continue;
            };
            let mut vx = 0.0;
            let mut vy = 0.0;
            if let Some(leader) = leader {
                let gap = distance(npc_position, leader);
                if gap > CATCHUP_DISTANCE {
                    // Land just behind the leader, on the side the NPC was on.
                    let target = Position {
                        x: leader.x + (npc_position.x - leader.x) / gap * CATCHUP_OFFSET,
                        y: leader.y + (npc_position.y - leader.y) / gap * CATCHUP_OFFSET,
                    };
                    if let Some(mut position) = self.world.get_mut::<Position>(npc_entity) {
                        position.x = target.x;
                        position.y = target.y;
                    }
                    self.npc_index
                        .insert_or_update(npc_entity, point_from_position(target));
                    catchups.push(NpcRelocatedEvent {
                        npc_id,
                        x: target.x,
                        y: target.y,
                    });
                } else if gap > FOLLOW_DISTANCE {
                    vx = (leader.x - npc_position.x) / gap * NPC_SPEED;
                    vy = (leader.y - npc_position.y) / gap * NPC_SPEED;
                }
            }
            if let Some(mut velocity) = self.world.get_mut::<Velocity>(npc_entity) {
                velocity.x = vx;
                velocity.y = vy;
            }
        }
        catchups
    }

    /// Scheduled relocation: authored content like "at 18:00 world time, Maren
    /// is at the square". Fires on the tick matching the entry's world-day
    /// offset; NPCs in a party (or with a pending invite) stay with the player.
    pub(super) fn relocate_scheduled_npcs(&mut self) -> Vec<NpcRelocatedEvent> {
        let ticks_per_day = self.world_day_seconds.max(1) * TICKS_PER_SECOND;
        let tick_in_day = self.tick % ticks_per_day;
        let mut moves: Vec<(Entity, String, Position)> = Vec::new();
        {
            let mut query = self.world.query::<&Npc>();
            for npc in query.iter(&self.world) {
                if self.npc_parties.contains_key(&npc.id) {
                    continue;
                }
                for entry in &npc.schedule {
                    let entry_tick =
                        (u64::from(entry.at_seconds) * TICKS_PER_SECOND) % ticks_per_day;
                    if entry_tick == tick_in_day {
                        if let Some(entity) = self.npc_entities.get(&npc.id) {
                            moves.push((
                                *entity,
                                npc.id.clone(),
                                Position {
                                    x: entry.x,
                                    y: entry.y,
                                },
                            ));
                        }
                    }
                }
            }
        }
        let mut events = Vec::new();
        for (entity, npc_id, destination) in moves {
            if let Some(mut position) = self.world.get_mut::<Position>(entity) {
                position.x = destination.x;
                position.y = destination.y;
            }
            self.npc_index
                .insert_or_update(entity, point_from_position(destination));
            events.push(NpcRelocatedEvent {
                npc_id,
                x: destination.x,
                y: destination.y,
            });
        }
        events
    }

    pub fn set_world_day_seconds(&mut self, seconds: u64) {
        self.world_day_seconds = seconds.max(1);
    }

    pub fn set_npc_invites_deterministic(&mut self, deterministic: bool) {
        self.npc_invites_deterministic = deterministic;
    }

    pub fn pending_npc_invite(&self, npc_id: &str) -> Option<(PlayerId, Uuid)> {
        match self.npc_parties.get(npc_id) {
            Some(NpcPartyState::Invited {
                player_id,
                invite_id,
                ..
            }) => Some((*player_id, *invite_id)),
            _ => None,
        }
    }

    pub fn player_display_name(&self, player_id: PlayerId) -> Option<String> {
        let entity = self.players.get(&player_id)?;
        self.world
            .get::<super::model::Player>(*entity)
            .map(|player| player.name.clone())
    }

    /// Authority-boundary range check for engine say intents: the target must
    /// still be near the NPC (2x talk radius tolerates walking during the
    /// engine's think time).
    pub fn npc_say_target_in_range(&self, player_id: PlayerId, npc_id: &str) -> bool {
        let Some(npc_entity) = self.npc_entities.get(npc_id) else {
            return false;
        };
        let Some(player_entity) = self.players.get(&player_id) else {
            return false;
        };
        let (Some(npc_position), Some(player_position)) = (
            self.world.get::<Position>(*npc_entity),
            self.world.get::<Position>(*player_entity),
        ) else {
            return false;
        };
        distance(*npc_position, *player_position) <= TALK_RADIUS * 2.0
    }

    /// Players currently within talk range of any of the given NPCs
    /// (the game-side greeting trigger; the engine debounces).
    pub fn players_near_npcs(
        &mut self,
        npc_ids: &std::collections::HashSet<String>,
    ) -> Vec<(PlayerId, String, String)> {
        let mut pairs = Vec::new();
        for npc_id in npc_ids {
            let Some(npc_entity) = self.npc_entities.get(npc_id) else {
                continue;
            };
            let Some(npc_position) = self.world.get::<Position>(*npc_entity).copied() else {
                continue;
            };
            for player_entity in self
                .player_index
                .query_radius(point_from_position(npc_position), TALK_RADIUS)
            {
                if let Some(player) = self.world.get::<super::model::Player>(player_entity) {
                    pairs.push((player.id, player.name.clone(), npc_id.clone()));
                }
            }
        }
        pairs
    }

    pub fn npc_party_leader(&self, npc_id: &str) -> Option<PlayerId> {
        match self.npc_parties.get(npc_id) {
            Some(NpcPartyState::InParty { player_id }) => Some(*player_id),
            _ => None,
        }
    }

    /// Validates that `player_id` may talk to `npc_id` right now and returns
    /// the NPC's persona id. The talk range check is the authority boundary
    /// for the `say` message (design D18).
    pub fn npc_talk_persona(
        &mut self,
        player_id: PlayerId,
        npc_id: &str,
    ) -> Result<String, NpcTalkError> {
        let npc_entity = *self
            .npc_entities
            .get(npc_id)
            .ok_or(NpcTalkError::UnknownNpc)?;
        let player_entity = *self
            .players
            .get(&player_id)
            .ok_or(NpcTalkError::UnknownPlayer)?;
        let npc_position = self
            .world
            .get::<Position>(npc_entity)
            .copied()
            .ok_or(NpcTalkError::UnknownNpc)?;
        let player_position = self
            .world
            .get::<Position>(player_entity)
            .copied()
            .ok_or(NpcTalkError::UnknownPlayer)?;
        if distance(npc_position, player_position) > TALK_RADIUS {
            return Err(NpcTalkError::OutOfRange);
        }
        let npc = self
            .world
            .get::<Npc>(npc_entity)
            .ok_or(NpcTalkError::UnknownNpc)?;
        Ok(npc.persona_id.clone())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NpcTalkError {
    UnknownNpc,
    UnknownPlayer,
    OutOfRange,
}

impl NpcTalkError {
    pub fn as_log_reason(&self) -> String {
        match self {
            NpcTalkError::UnknownNpc => "say_unknown_npc",
            NpcTalkError::UnknownPlayer => "say_unknown_player",
            NpcTalkError::OutOfRange => "say_out_of_range",
        }
        .to_string()
    }
}
