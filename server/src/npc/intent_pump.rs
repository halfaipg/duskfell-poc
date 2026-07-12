use tokio::sync::mpsc;
use tracing::{info, warn};
use uuid::Uuid;

use animus::{EngineOutput, FallbackTrigger, GameEvent};

use crate::journal::JournalEventKind;
use crate::protocol::{NpcSaySource, PlayerId};
use crate::tick_loop::record_journal;
use crate::AppState;

use super::dialogue::{stream_reply, SpeechRequest};
use super::speech::MAX_SAY_CHARS;

/// Consumes engine outputs and executes them under the game's authority
/// boundary (design D5, second gate): every intent is re-validated against
/// live sim state before anything reaches a player or the world. Fallbacks
/// route to the deterministic canned responder.
pub async fn run_intent_pump(state: AppState, mut outputs: mpsc::Receiver<EngineOutput>) {
    while let Some(output) = outputs.recv().await {
        match output {
            EngineOutput::Intent {
                npc_id,
                decision_id,
                verb,
                params,
                in_reply_to_actor,
            } => {
                execute_intent(
                    &state,
                    npc_id,
                    decision_id,
                    &verb,
                    params,
                    in_reply_to_actor,
                )
                .await
            }
            EngineOutput::Fallback {
                npc_id,
                decision_id: _,
                trigger,
            } => execute_fallback(&state, npc_id, trigger).await,
            EngineOutput::StatusChanged { status } => {
                info!(status = %status.detail(), "npc cognition status changed");
                if let Some(bridge) = &state.npc_engine {
                    *bridge.status.lock().await = status.clone();
                }
                let tick = state.sim.lock().await.tick_count();
                record_journal(
                    &state,
                    tick,
                    JournalEventKind::NpcCognitionStatusChanged {
                        status: status.detail(),
                    },
                )
                .await;
            }
        }
    }
}

async fn execute_intent(
    state: &AppState,
    npc_id: String,
    decision_id: String,
    verb: &str,
    params: serde_json::Value,
    in_reply_to_actor: Option<String>,
) {
    match verb {
        "say" => {
            // Models routinely omit the optional targetId param; the actor
            // whose speech triggered the decision is the natural target.
            let target_id = params
                .get("targetId")
                .and_then(|value| value.as_str())
                .and_then(|value| value.parse::<PlayerId>().ok())
                .or_else(|| in_reply_to_actor.and_then(|actor| actor.parse::<PlayerId>().ok()));
            let Some(target_id) = target_id else {
                reject_intent(state, &npc_id, &decision_id, "say-target-missing").await;
                return;
            };
            let Some(text) = params.get("text").and_then(|value| value.as_str()) else {
                reject_intent(state, &npc_id, &decision_id, "say-text-missing").await;
                return;
            };
            let text: String = text.chars().take(MAX_SAY_CHARS * 4).collect();
            let in_range = state
                .sim
                .lock()
                .await
                .npc_say_target_in_range(target_id, &npc_id);
            if !in_range {
                reject_intent(state, &npc_id, &decision_id, "say-target-out-of-range").await;
                return;
            }
            let reply = stream_reply(
                &state.npc_say_routes,
                &state.metrics,
                target_id,
                &npc_id,
                NpcSaySource::Live,
                &text,
            )
            .await;
            let tick = state.sim.lock().await.tick_count();
            record_journal(
                state,
                tick,
                JournalEventKind::NpcSaid {
                    player_id: reply.player_id,
                    npc_id: reply.npc_id,
                    say_id: reply.say_id,
                    chars: reply.chars,
                    source: "live".to_string(),
                },
            )
            .await;
        }
        "acceptParty" | "declineParty" => {
            let accept = verb == "acceptParty";
            // The model is told the inviteId, but an NPC has at most one
            // pending invite, so a garbled echo must not strand the decision.
            let invite_id = params
                .get("inviteId")
                .and_then(|value| value.as_str())
                .and_then(|value| value.parse::<Uuid>().ok());
            let inviter = state
                .sim
                .lock()
                .await
                .pending_npc_invite(&npc_id)
                .map(|(player_id, _)| player_id);
            resolve_invite(state, &npc_id, Some(&decision_id), invite_id, accept).await;
            if !accept {
                if let (Some(player_id), Some(text)) =
                    (inviter, params.get("text").and_then(|value| value.as_str()))
                {
                    let reply = stream_reply(
                        &state.npc_say_routes,
                        &state.metrics,
                        player_id,
                        &npc_id,
                        NpcSaySource::Live,
                        text,
                    )
                    .await;
                    let tick = state.sim.lock().await.tick_count();
                    record_journal(
                        state,
                        tick,
                        JournalEventKind::NpcSaid {
                            player_id: reply.player_id,
                            npc_id: reply.npc_id,
                            say_id: reply.say_id,
                            chars: reply.chars,
                            source: "live".to_string(),
                        },
                    )
                    .await;
                }
            }
        }
        "leaveParty" => {
            let leader = state.sim.lock().await.npc_party_leader(&npc_id);
            let Some(player_id) = leader else {
                reject_intent(state, &npc_id, &decision_id, "leave-party-not-in-party").await;
                return;
            };
            let left = state
                .sim
                .lock()
                .await
                .leave_npc_party(player_id, &npc_id)
                .is_ok();
            if left {
                let tick = state.sim.lock().await.tick_count();
                let npc_name = super::npc_display_name(state, &npc_id);
                record_journal(
                    state,
                    tick,
                    JournalEventKind::NpcPartyLeft { player_id, npc_id },
                )
                .await;
                super::egress::send_notice(
                    &state.npc_say_routes,
                    &state.metrics,
                    player_id,
                    crate::protocol::NoticeLevel::Info,
                    format!("{npc_name} left your party."),
                )
                .await;
            }
        }
        other => {
            reject_intent(
                state,
                &npc_id,
                &decision_id,
                &format!("unknown-verb {other}"),
            )
            .await;
        }
    }
}

async fn execute_fallback(state: &AppState, npc_id: String, trigger: FallbackTrigger) {
    match trigger {
        FallbackTrigger::Speech { actor_id } => {
            let Ok(player_id) = actor_id.parse::<PlayerId>() else {
                return;
            };
            let Some(persona_id) = state.npc_personas.get(&npc_id).cloned() else {
                return;
            };
            let request = SpeechRequest {
                player_id,
                npc_id,
                persona_id,
                text: String::new(),
            };
            if state.npc_speech_tx.try_send(request).is_err() {
                state.metrics.npc_say_dropped();
            }
        }
        FallbackTrigger::PartyInvite { invite_id } => {
            // Degraded cognition declines rather than ghosting the player (D7).
            let Ok(invite_id) = invite_id.parse::<Uuid>() else {
                return;
            };
            resolve_invite(state, &npc_id, None, Some(invite_id), false).await;
            let Some(persona_id) = state.npc_personas.get(&npc_id).cloned() else {
                return;
            };
            if let Some((player_id, _)) = pending_or_declined_inviter(state, invite_id).await {
                let request = SpeechRequest {
                    player_id,
                    npc_id,
                    persona_id,
                    text: String::new(),
                };
                if state.npc_speech_tx.try_send(request).is_err() {
                    state.metrics.npc_say_dropped();
                }
            }
        }
        FallbackTrigger::Greeting { .. } => {
            // A skipped greeting is harmless (design §4).
        }
    }
}

async fn resolve_invite(
    state: &AppState,
    npc_id: &str,
    decision_id: Option<&str>,
    invite_id: Option<Uuid>,
    accept: bool,
) {
    let mut sim = state.sim.lock().await;
    let Some((_player_id, pending_invite)) = sim.pending_npc_invite(npc_id) else {
        if let Some(decision_id) = decision_id {
            drop(sim);
            reject_intent(state, npc_id, decision_id, "party-invite-not-pending").await;
        }
        return;
    };
    match invite_id {
        Some(invite_id) if invite_id != pending_invite => {
            warn!(
                npc_id,
                %invite_id,
                %pending_invite,
                "party decision echoed a mismatched inviteId; resolving the pending invite"
            );
        }
        None => {
            warn!(
                npc_id,
                %pending_invite,
                "party decision omitted or garbled inviteId; resolving the pending invite"
            );
        }
        _ => {}
    }
    let event = sim.resolve_npc_party_invite(npc_id, accept);
    let tick = sim.tick_count();
    drop(sim);
    if let Some(event) = event {
        super::notify_party_event(state, &event).await;
        let kind = match event {
            crate::sim::NpcPartyEvent::Joined { player_id, npc_id } => {
                JournalEventKind::NpcPartyJoined { player_id, npc_id }
            }
            crate::sim::NpcPartyEvent::Declined {
                player_id,
                npc_id,
                invite_id,
            } => JournalEventKind::NpcPartyDeclined {
                player_id,
                npc_id,
                invite_id,
            },
        };
        record_journal(state, tick, kind).await;
    }
}

/// After a decline resolves, the inviter's id is no longer in sim state; the
/// journal's in-memory ring still has it. Cheap lookup, cold path only.
async fn pending_or_declined_inviter(
    state: &AppState,
    invite_id: Uuid,
) -> Option<(PlayerId, Uuid)> {
    let journal = state.journal.lock().await;
    journal.recent(50).into_iter().rev().find_map(|event| {
        if let JournalEventKind::NpcPartyDeclined {
            player_id,
            invite_id: declined,
            ..
        }
        | JournalEventKind::NpcPartyInvited {
            player_id,
            invite_id: declined,
            ..
        } = event.kind
        {
            (declined == invite_id).then_some((player_id, invite_id))
        } else {
            None
        }
    })
}

async fn reject_intent(state: &AppState, npc_id: &str, decision_id: &str, reason: &str) {
    warn!(npc_id, decision_id, reason, "npc intent rejected");
    let tick = state.sim.lock().await.tick_count();
    record_journal(
        state,
        tick,
        JournalEventKind::NpcIntentRejected {
            npc_id: npc_id.to_string(),
            decision_id: decision_id.to_string(),
            reason: reason.to_string(),
        },
    )
    .await;
    // Feed the rejection back so the NPC's next decision can adapt (§3.4).
    if let Some(bridge) = &state.npc_engine {
        let _ = bridge.events.try_send(GameEvent::IntentRejected {
            npc_id: npc_id.to_string(),
            decision_id: decision_id.to_string(),
            reason: reason.to_string(),
        });
    }
}
