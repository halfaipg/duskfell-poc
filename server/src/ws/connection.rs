use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket};
use tokio::sync::OwnedSemaphorePermit;
use tracing::error;

use crate::admission::{AccountConnectionPermit, PeerConnectionPermit};
use crate::ingress::ClientIngress;
use crate::journal::JournalEventKind;
use crate::protocol::PlayerId;
use crate::tick_loop::{record_journal, remove_player};
use crate::AppState;

use super::client_messages::{handle_client_text, record_rejection};
use super::snapshots::{send_snapshot, send_welcome};

pub(super) async fn player_socket(
    mut socket: WebSocket,
    state: AppState,
    _connection_permit: OwnedSemaphorePermit,
    peer_permit: PeerConnectionPermit,
    account_permit: AccountConnectionPermit,
    player_id: PlayerId,
    display_name: Option<String>,
    account_subject: Option<String>,
) {
    state.metrics.connection_opened();
    {
        let mut sim = state.sim.lock().await;
        if let Err(err) =
            sim.add_player_with_identity(player_id, display_name, account_subject.clone())
        {
            state.metrics.message_rejected();
            record_journal(
                &state,
                sim.tick_count(),
                JournalEventKind::ClientMessageRejected {
                    player_id,
                    reason: err.as_log_reason(),
                },
            )
            .await;
            let _ = socket.send(Message::Close(None)).await;
            state.metrics.connection_closed();
            account_permit.release().await;
            peer_permit.release().await;
            return;
        }
        record_journal(
            &state,
            sim.tick_count(),
            JournalEventKind::PlayerJoined {
                player_id,
                account_subject,
            },
        )
        .await;
    }

    if let Err(err) = send_welcome(&mut socket, &state, player_id).await {
        state.metrics.send_error();
        error!(%err, "failed to send welcome");
        remove_player(&state, player_id).await;
        state.metrics.connection_closed();
        account_permit.release().await;
        peer_permit.release().await;
        return;
    }

    let mut send_interval = tokio::time::interval(state.websocket_config.snapshot_interval);
    let mut heartbeat_interval = tokio::time::interval(state.websocket_config.heartbeat_interval);
    let mut idle_check_interval = tokio::time::interval(Duration::from_millis(250));
    let mut last_client_seen = Instant::now();
    let mut ingress = ClientIngress::new(state.ingress_config.clone());
    let mut rejected_messages = 0usize;
    let mut npc_say_rx = crate::npc::egress::register_route(&state.npc_say_routes, player_id).await;
    loop {
        tokio::select! {
            Some(frame) = npc_say_rx.recv() => {
                match serde_json::to_string(&frame) {
                    Ok(payload) => {
                        state.metrics.message_out(payload.len());
                        if let Err(err) = socket.send(Message::Text(payload)).await {
                            state.metrics.send_error();
                            error!(%err, "npc say send failed");
                            break;
                        }
                    }
                    Err(err) => {
                        error!(%err, "failed to serialize npc say frame");
                    }
                }
            }
            _ = send_interval.tick() => {
                if let Err(err) = send_snapshot(&mut socket, &state, player_id).await {
                    state.metrics.send_error();
                    error!(%err, "websocket send failed");
                    break;
                }
            }
            _ = heartbeat_interval.tick() => {
                if let Err(err) = socket.send(Message::Ping(Vec::new())).await {
                    state.metrics.send_error();
                    error!(%err, "websocket heartbeat failed");
                    break;
                }
                state.metrics.heartbeat_ping();
            }
            _ = idle_check_interval.tick() => {
                if last_client_seen.elapsed() >= state.websocket_config.idle_timeout {
                    state.metrics.idle_timeout();
                    error!(
                        player_id = %player_id,
                        idle_timeout_seconds = state.websocket_config.idle_timeout.as_secs(),
                        "websocket idle timeout"
                    );
                    break;
                }
            }
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        last_client_seen = Instant::now();
                        if handle_client_text(&state, player_id, &text, &mut ingress).await {
                            rejected_messages += 1;
                            if rejected_messages >= state.client_reject_limit {
                                error!(
                                    player_id = %player_id,
                                    rejected_messages,
                                    reject_limit = state.client_reject_limit,
                                    "websocket client reject limit exceeded"
                                );
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(payload))) => {
                        last_client_seen = Instant::now();
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            state.metrics.send_error();
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {
                        last_client_seen = Instant::now();
                    }
                    Some(Ok(Message::Binary(payload))) => {
                        let reason = ingress.reject_binary_frame(payload.len());
                        record_rejection(&state, player_id, reason).await;
                        break;
                    }
                    Some(Err(err)) => {
                        error!(%err, "websocket receive failed");
                        break;
                    }
                }
            }
        }
    }

    crate::npc::egress::unregister_route(&state.npc_say_routes, player_id).await;
    remove_player(&state, player_id).await;
    state.metrics.connection_closed();
    account_permit.release().await;
    peer_permit.release().await;
}
