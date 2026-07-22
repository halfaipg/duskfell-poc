use crate::protocol::PlayerId;

use super::model::{NpcTalkTarget, Position, SimWorld};
use super::movement::distance;

pub const NPC_TALK_RADIUS: f32 = 180.0;

impl SimWorld {
    pub fn nearest_npc_for_player(&self, player_id: PlayerId) -> Option<NpcTalkTarget> {
        let player_entity = self.players.get(&player_id)?;
        let player_position = self.world.get::<Position>(*player_entity)?;
        self.npcs
            .values()
            .filter_map(|npc| {
                let gap = distance(*player_position, npc.position);
                (gap <= NPC_TALK_RADIUS).then_some((gap, npc))
            })
            .min_by(|(left, _), (right, _)| left.total_cmp(right))
            .map(|(_, npc)| NpcTalkTarget {
                id: npc.id.clone(),
                persona: npc.persona.clone(),
            })
    }

    pub fn npc_in_talk_range(&self, player_id: PlayerId, npc_id: &str) -> bool {
        let Some(player_entity) = self.players.get(&player_id) else {
            return false;
        };
        let Some(player_position) = self.world.get::<Position>(*player_entity) else {
            return false;
        };
        self.npcs
            .get(npc_id)
            .map(|npc| distance(*player_position, npc.position) <= NPC_TALK_RADIUS * 2.0)
            .unwrap_or(false)
    }
}
