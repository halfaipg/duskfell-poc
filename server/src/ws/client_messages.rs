use tracing::error;

use crate::ingress::{ClientIngress, IngressRejectReason};
use crate::journal::JournalEventKind;
use crate::npc::egress::send_notice;
use crate::npc::npc_display_name;
use crate::protocol::{ClientMessage, NoticeLevel, PlayerId};
use crate::sim::{NpcPartyError, NpcTalkError, PlayerInput};
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
        Ok(ClientMessage::PartyInvite { npc_id }) => {
            let mut sim = state.sim.lock().await;
            match sim.invite_npc_to_party(player_id, &npc_id) {
                Ok(invite) => {
                    let actor_name = sim
                        .player_display_name(player_id)
                        .unwrap_or_else(|| "Wayfarer".to_string());
                    record_journal(
                        state,
                        sim.tick_count(),
                        JournalEventKind::NpcPartyInvited {
                            player_id,
                            npc_id: npc_id.clone(),
                            invite_id: invite.invite_id,
                        },
                    )
                    .await;
                    let npc_name = npc_display_name(state, &npc_id);
                    send_notice(
                        &state.npc_say_routes,
                        &state.metrics,
                        player_id,
                        NoticeLevel::Info,
                        format!("You invited {npc_name} to your party."),
                    )
                    .await;
                    // With the engine running the NPC decides; the sim's
                    // deterministic auto-accept is disabled. If the engine
                    // queue is full the engine emits a Fallback (decline).
                    if let Some(bridge) = &state.npc_engine {
                        let send_result = bridge.events.try_send(animus::GameEvent::PartyInvite {
                            npc_id: npc_id.clone(),
                            invite_id: invite.invite_id.to_string(),
                            actor_id: player_id.to_string(),
                            actor_name,
                        });
                        if send_result.is_err() {
                            // Never leave an invite parked with nobody to
                            // resolve it: decline deterministically.
                            let mut sim = state.sim.lock().await;
                            if let Some(event) = sim.resolve_npc_party_invite(&npc_id, false) {
                                let tick = sim.tick_count();
                                drop(sim);
                                crate::npc::notify_party_event(state, &event).await;
                                if let crate::sim::NpcPartyEvent::Declined {
                                    player_id,
                                    npc_id,
                                    invite_id,
                                } = event
                                {
                                    record_journal(
                                        state,
                                        tick,
                                        JournalEventKind::NpcPartyDeclined {
                                            player_id,
                                            npc_id,
                                            invite_id,
                                        },
                                    )
                                    .await;
                                }
                            }
                        }
                    }
                    false
                }
                Err(err) => {
                    // Gameplay races (walked out of range, NPC already busy) are
                    // journaled but do not count toward the disconnect limit.
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
                    drop(sim);
                    let npc_name = npc_display_name(state, &npc_id);
                    let feedback = match err {
                        NpcPartyError::OutOfRange => {
                            Some(format!("You're too far away to invite {npc_name}."))
                        }
                        NpcPartyError::NpcBusy => {
                            Some(format!("{npc_name} is already traveling with someone."))
                        }
                        NpcPartyError::PlayerBusy => {
                            Some("You already have a traveling companion.".to_string())
                        }
                        _ => None,
                    };
                    if let Some(message) = feedback {
                        send_notice(
                            &state.npc_say_routes,
                            &state.metrics,
                            player_id,
                            NoticeLevel::Warn,
                            message,
                        )
                        .await;
                    }
                    false
                }
            }
        }
        Ok(ClientMessage::PartyLeave { npc_id }) => {
            let mut sim = state.sim.lock().await;
            match sim.leave_npc_party(player_id, &npc_id) {
                Ok(()) => {
                    record_journal(
                        state,
                        sim.tick_count(),
                        JournalEventKind::NpcPartyLeft {
                            player_id,
                            npc_id: npc_id.clone(),
                        },
                    )
                    .await;
                    drop(sim);
                    let npc_name = npc_display_name(state, &npc_id);
                    send_notice(
                        &state.npc_say_routes,
                        &state.metrics,
                        player_id,
                        NoticeLevel::Info,
                        format!("You parted ways with {npc_name}."),
                    )
                    .await;
                    false
                }
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
                    false
                }
            }
        }
        Ok(ClientMessage::Say { npc_id, text }) => {
            if let Err(reason) = ingress.allow_say() {
                record_rejection(state, player_id, reason).await;
                return true;
            }
            let clean_text = match crate::npc::speech::validate_say_text(&text) {
                Ok(clean) => clean,
                Err(err) => {
                    // Malformed speech is a protocol violation: the client caps
                    // input at the same bounds, so this counts like bad rename.
                    state.metrics.message_rejected();
                    let tick = state.sim.lock().await.tick_count();
                    record_journal(
                        state,
                        tick,
                        JournalEventKind::ClientMessageRejected {
                            player_id,
                            reason: err.as_log_reason(),
                        },
                    )
                    .await;
                    return true;
                }
            };
            let mut sim = state.sim.lock().await;
            match sim.npc_talk_persona(player_id, &npc_id) {
                Ok(persona_id) => {
                    let actor_name = sim
                        .player_display_name(player_id)
                        .unwrap_or_else(|| "Wayfarer".to_string());
                    record_journal(
                        state,
                        sim.tick_count(),
                        JournalEventKind::PlayerSpokeToNpc {
                            player_id,
                            npc_id: npc_id.clone(),
                            text: clean_text.clone(),
                        },
                    )
                    .await;
                    drop(sim);
                    // Cognition engine first; deterministic canned responder
                    // when the engine is off or its queue is full. Neither
                    // path ever blocks the socket task on the LLM.
                    let mut handled_by_engine = false;
                    if let Some(bridge) = &state.npc_engine {
                        handled_by_engine = bridge
                            .events
                            .try_send(animus::GameEvent::ActorSpoke {
                                npc_id: npc_id.clone(),
                                actor_id: player_id.to_string(),
                                actor_name,
                                text: clean_text.clone(),
                            })
                            .is_ok();
                    }
                    if !handled_by_engine {
                        let request = crate::npc::dialogue::SpeechRequest {
                            player_id,
                            npc_id,
                            persona_id,
                            text: clean_text,
                        };
                        if state.npc_speech_tx.try_send(request).is_err() {
                            state.metrics.npc_say_dropped();
                        }
                    }
                    false
                }
                Err(err) => {
                    // Out-of-range/unknown targets are gameplay races, not
                    // protocol violations: journaled but no disconnect pressure.
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
                    drop(sim);
                    if err == NpcTalkError::OutOfRange {
                        let npc_name = npc_display_name(state, &npc_id);
                        send_notice(
                            &state.npc_say_routes,
                            &state.metrics,
                            player_id,
                            NoticeLevel::Warn,
                            format!("You're too far away to talk to {npc_name}."),
                        )
                        .await;
                    }
                    false
                }
            }
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
