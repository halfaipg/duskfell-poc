pub mod dialogue;
pub mod egress;
pub mod engine_bridge;
pub mod intent_pump;
pub mod speech;

pub fn npc_display_name(state: &crate::AppState, npc_id: &str) -> String {
    state
        .npc_names
        .get(npc_id)
        .cloned()
        .unwrap_or_else(|| npc_id.to_string())
}

/// Tells the affected player how their party invite resolved, as a system
/// line on their dialogue surface.
pub async fn notify_party_event(state: &crate::AppState, event: &crate::sim::NpcPartyEvent) {
    use crate::protocol::NoticeLevel;
    use crate::sim::NpcPartyEvent;

    let (player_id, message) = match event {
        NpcPartyEvent::Joined { player_id, npc_id } => (
            *player_id,
            format!(
                "{name} joined your party and will follow you. Press P near them to part ways.",
                name = npc_display_name(state, npc_id)
            ),
        ),
        NpcPartyEvent::Declined {
            player_id, npc_id, ..
        } => (
            *player_id,
            format!(
                "{name} declined to join your party.",
                name = npc_display_name(state, npc_id)
            ),
        ),
    };
    egress::send_notice(
        &state.npc_say_routes,
        &state.metrics,
        player_id,
        NoticeLevel::Info,
        message,
    )
    .await;
}
