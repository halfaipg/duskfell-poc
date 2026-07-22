use tracing::error;

use crate::ingress::{ClientIngress, IngressRejectReason};
use crate::journal::JournalEventKind;
use crate::protocol::{ClientMessage, PlayerId};
use crate::sim::{ActorId, ActorIntent, PlayerInput};
use crate::tick_loop::record_journal;
use crate::AppState;

pub(super) async fn handle_client_text(
    state: &AppState,
    player_id: PlayerId,
    text: &str,
    ingress: &mut ClientIngress,
) -> bool {
    if let Err(reason) = ingress.allow_text_frame(text.len()) {
        record_rejection(state, player_id, reason).await;
        return true;
    }
    state.metrics.message_in();

    match serde_json::from_str::<ClientMessage>(text) {
        Ok(ClientMessage::Input {
            seq,
            up,
            down,
            left,
            right,
            interact,
        }) => {
            if let Err(reason) = ingress.accept_input_sequence(seq) {
                record_rejection(state, player_id, reason).await;
                return true;
            }

            state.sim.lock().await.set_input(
                player_id,
                PlayerInput {
                    up,
                    down,
                    left,
                    right,
                    interact,
                },
            );
            false
        }
        Ok(ClientMessage::Say { text }) => {
            if let Err(reason) = ingress.allow_say() {
                record_rejection(state, player_id, reason).await;
                return true;
            }
            let applied = {
                let mut sim = state.sim.lock().await;
                let Ok(applied) = sim.apply_actor_intent(
                    ActorId::Player(player_id),
                    ActorIntent::Say {
                        text,
                        audience: None,
                    },
                ) else {
                    return false;
                };
                applied
            };
            if let Some(target) = applied.nearby_npc {
                let accepted = state
                    .cognition
                    .as_ref()
                    .map(|bridge| {
                        bridge
                            .events
                            .try_send(animus::GameEvent::ActorSpoke {
                                npc_id: target.id.clone(),
                                actor_id: player_id.to_string(),
                                actor_name: applied.actor_name,
                                text: applied.clean_text,
                            })
                            .is_ok()
                    })
                    .unwrap_or(false);
                if !accepted {
                    let _ = state
                        .sim
                        .lock()
                        .await
                        .apply_npc_canned_intent(&target.id, player_id);
                }
            }
            false
        }
        Ok(ClientMessage::Rename { name }) => {
            let mut sim = state.sim.lock().await;
            match sim.rename_player(player_id, &name) {
                Ok(Some(name)) => {
                    record_journal(
                        state,
                        sim.tick_count(),
                        JournalEventKind::PlayerRenamed { player_id, name },
                    )
                    .await;
                    false
                }
                Ok(None) => false,
                Err(err) => {
                    state.metrics.message_rejected();
                    record_journal(
                        state,
                        sim.tick_count(),
                        JournalEventKind::ClientMessageRejected {
                            player_id,
                            reason: err.as_log_reason(),
                        },
                    )
                    .await;
                    true
                }
            }
        }
        Err(err) => {
            state.metrics.message_rejected();
            let tick = state.sim.lock().await.tick_count();
            record_journal(
                state,
                tick,
                JournalEventKind::BadClientMessage {
                    player_id,
                    error: err.to_string(),
                },
            )
            .await;
            error!(%err, "bad client message");
            true
        }
    }
}

pub(super) async fn record_rejection(
    state: &AppState,
    player_id: PlayerId,
    reason: IngressRejectReason,
) {
    state.metrics.ingress_message_rejected(&reason);
    let tick = state.sim.lock().await.tick_count();
    record_journal(
        state,
        tick,
        JournalEventKind::ClientMessageRejected {
            player_id,
            reason: reason.as_log_reason(),
        },
    )
    .await;
}
