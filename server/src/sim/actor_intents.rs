use crate::protocol::PlayerId;

use super::model::{NpcTalkTarget, Player, PlayerSpeech, SimWorld};

const PLAYER_SPEECH_MAX_CHARS: usize = 96;
const NPC_SPEECH_MAX_CHARS: usize = 128;
const TICKS_PER_SECOND: u64 = 20;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ActorId {
    Player(PlayerId),
    Npc(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ActorIntent {
    Say {
        text: String,
        audience: Option<PlayerId>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AppliedActorIntent {
    pub(crate) clean_text: String,
    pub(crate) actor_name: String,
    pub(crate) nearby_npc: Option<NpcTalkTarget>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActorIntentError {
    UnknownActor,
    InvalidAudience,
    AudienceOutOfRange,
    EmptySpeech,
}

impl ActorIntentError {
    pub(crate) fn as_log_reason(self) -> &'static str {
        match self {
            Self::UnknownActor => "unknown_actor",
            Self::InvalidAudience => "invalid_audience",
            Self::AudienceOutOfRange => "audience_out_of_range",
            Self::EmptySpeech => "empty_speech",
        }
    }
}

impl SimWorld {
    /// The sole gameplay mutation boundary for speech, regardless of whether
    /// the intent originated from a player, deterministic fallback, or model.
    pub(crate) fn apply_actor_intent(
        &mut self,
        actor: ActorId,
        intent: ActorIntent,
    ) -> Result<AppliedActorIntent, ActorIntentError> {
        match (actor, intent) {
            (ActorId::Player(player_id), ActorIntent::Say { text, audience }) => {
                if audience.is_some() {
                    return Err(ActorIntentError::InvalidAudience);
                }
                self.apply_player_speech(player_id, &text)
            }
            (ActorId::Npc(npc_id), ActorIntent::Say { text, audience }) => {
                let audience = audience.ok_or(ActorIntentError::InvalidAudience)?;
                if !self.npcs.contains_key(&npc_id) {
                    return Err(ActorIntentError::UnknownActor);
                }
                if !self.players.contains_key(&audience) {
                    return Err(ActorIntentError::InvalidAudience);
                }
                if !self.npc_in_talk_range(audience, &npc_id) {
                    return Err(ActorIntentError::AudienceOutOfRange);
                }
                self.apply_npc_speech(&npc_id, &text)
            }
        }
    }

    pub(crate) fn apply_npc_canned_intent(
        &mut self,
        npc_id: &str,
        audience: PlayerId,
    ) -> Result<AppliedActorIntent, ActorIntentError> {
        let line = {
            let npc = self
                .npcs
                .get(npc_id)
                .ok_or(ActorIntentError::UnknownActor)?;
            if npc.canned.is_empty() {
                return Err(ActorIntentError::EmptySpeech);
            }
            npc.canned[npc.canned_cursor % npc.canned.len()].clone()
        };

        let applied = self.apply_actor_intent(
            ActorId::Npc(npc_id.to_string()),
            ActorIntent::Say {
                text: line,
                audience: Some(audience),
            },
        )?;
        if let Some(npc) = self.npcs.get_mut(npc_id) {
            npc.canned_cursor = npc.canned_cursor.wrapping_add(1);
        }
        Ok(applied)
    }

    fn apply_player_speech(
        &mut self,
        player_id: PlayerId,
        text: &str,
    ) -> Result<AppliedActorIntent, ActorIntentError> {
        let clean = sanitize_speech(text, PLAYER_SPEECH_MAX_CHARS);
        if clean.is_empty() {
            return Err(ActorIntentError::EmptySpeech);
        }
        let entity = self
            .players
            .get(&player_id)
            .copied()
            .ok_or(ActorIntentError::UnknownActor)?;
        let actor_name = self
            .world
            .get::<Player>(entity)
            .map(|player| player.name.clone())
            .ok_or(ActorIntentError::UnknownActor)?;
        let nearby_npc = self.nearest_npc_for_player(player_id);
        let duration_ticks =
            (TICKS_PER_SECOND * 3 + clean.chars().count() as u64 / 2).min(TICKS_PER_SECOND * 10);
        self.world
            .get_mut::<Player>(entity)
            .ok_or(ActorIntentError::UnknownActor)?
            .speech = Some(PlayerSpeech {
            text: clean.clone(),
            until_tick: self.tick.saturating_add(duration_ticks),
        });

        Ok(AppliedActorIntent {
            clean_text: clean,
            actor_name,
            nearby_npc,
        })
    }

    fn apply_npc_speech(
        &mut self,
        npc_id: &str,
        text: &str,
    ) -> Result<AppliedActorIntent, ActorIntentError> {
        let clean = sanitize_speech(text, NPC_SPEECH_MAX_CHARS);
        if clean.is_empty() {
            return Err(ActorIntentError::EmptySpeech);
        }
        let npc = self
            .npcs
            .get_mut(npc_id)
            .ok_or(ActorIntentError::UnknownActor)?;
        let duration_ticks =
            (TICKS_PER_SECOND * 3 + clean.chars().count() as u64 / 2).min(TICKS_PER_SECOND * 12);
        npc.speech = Some(PlayerSpeech {
            text: clean.clone(),
            until_tick: self.tick.saturating_add(duration_ticks),
        });

        Ok(AppliedActorIntent {
            clean_text: clean,
            actor_name: npc.name.clone(),
            nearby_npc: None,
        })
    }
}

fn sanitize_speech(text: &str, max_chars: usize) -> String {
    text.chars()
        .filter(|character| !character.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(max_chars)
        .collect()
}
