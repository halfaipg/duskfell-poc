use anyhow::anyhow;
use axum::extract::ws::{Message, WebSocket};

use crate::protocol::{PlayerId, ServerMessage};
use crate::AppState;

pub(super) async fn send_welcome(
    socket: &mut WebSocket,
    state: &AppState,
    player_id: PlayerId,
) -> anyhow::Result<()> {
    let settlement = state
        .settlement_ledger
        .lock()
        .await
        .snapshot(state.settlement_config.chain_enabled);
    let snapshot = state.sim.lock().await.snapshot_for_player(
        player_id,
        settlement,
        state.websocket_config.interest_radius,
    );
    let message = ServerMessage::Welcome {
        player_id,
        snapshot,
    };
    let text = serde_json::to_string(&message)?;
    record_snapshot_visibility(state, &message);
    ensure_snapshot_payload_size(state, text.len())?;
    state.metrics.message_out(text.len());
    socket.send(Message::Text(text)).await?;
    Ok(())
}

pub(super) async fn send_snapshot(
    socket: &mut WebSocket,
    state: &AppState,
    player_id: PlayerId,
) -> anyhow::Result<()> {
    let settlement = state
        .settlement_ledger
        .lock()
        .await
        .snapshot(state.settlement_config.chain_enabled);
    let snapshot = state.sim.lock().await.snapshot_for_player(
        player_id,
        settlement,
        state.websocket_config.interest_radius,
    );
    let visible_players = snapshot.players.len();
    let visible_objects = snapshot.objects.len();
    let message = ServerMessage::Snapshot(snapshot);
    let text = serde_json::to_string(&message)?;
    state
        .metrics
        .snapshot_visibility_observed(visible_players, visible_objects);
    ensure_snapshot_payload_size(state, text.len())?;
    state.metrics.snapshot_out(text.len());
    socket.send(Message::Text(text)).await?;
    Ok(())
}

fn record_snapshot_visibility(state: &AppState, message: &ServerMessage) {
    let snapshot = match message {
        ServerMessage::Welcome { snapshot, .. } | ServerMessage::Snapshot(snapshot) => snapshot,
        ServerMessage::Notice { .. } => return,
    };
    state
        .metrics
        .snapshot_visibility_observed(snapshot.players.len(), snapshot.objects.len());
}

fn ensure_snapshot_payload_size(state: &AppState, bytes: usize) -> anyhow::Result<()> {
    if bytes <= state.max_snapshot_bytes {
        return Ok(());
    }

    state.metrics.snapshot_payload_rejected();
    Err(anyhow!(
        "serialized snapshot payload exceeded MAX_SNAPSHOT_BYTES: bytes={} max={}",
        bytes,
        state.max_snapshot_bytes
    ))
}
