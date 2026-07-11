use std::time::Instant;

use tracing::error;

use crate::journal::JournalEventKind;
use crate::protocol::PlayerId;
use crate::{settlement, AppState, SERVER_TICK_BUDGET};

pub(crate) async fn run_tick_loop(state: AppState) {
    let mut interval = tokio::time::interval(SERVER_TICK_BUDGET);
    loop {
        interval.tick().await;
        let started_at = Instant::now();
        let (tick, outcome) = {
            let mut sim = state.sim.lock().await;
            let outcome = sim.tick(0.05);
            (sim.tick_count(), outcome)
        };
        // 1 Hz greeting trigger: players lingering near greeting-enabled NPCs
        // (D17). The engine debounces per pair; here we only detect proximity.
        if tick % 20 == 0 && !state.greeting_npc_ids.is_empty() {
            if let Some(bridge) = &state.npc_engine {
                let pairs = {
                    let mut sim = state.sim.lock().await;
                    sim.players_near_npcs(&state.greeting_npc_ids)
                };
                for (player_id, player_name, npc_id) in pairs {
                    let _ = bridge.events.try_send(animus::GameEvent::ActorLingered {
                        npc_id,
                        actor_id: player_id.to_string(),
                        actor_name: player_name,
                    });
                }
            }
        }
        for event in outcome.resource_events {
            record_journal(
                &state,
                tick,
                JournalEventKind::ResourceGathered {
                    player_id: event.player_id,
                    object_id: event.object_id,
                    resource: event.resource,
                    amount: event.amount,
                    total: event.total,
                },
            )
            .await;
        }
        for event in outcome.resource_feed_events {
            record_journal(
                &state,
                tick,
                JournalEventKind::ResourceFed {
                    player_id: event.player_id,
                    object_id: event.object_id,
                    input_resource: event.input_resource,
                    input_amount: event.input_amount,
                    input_total: event.input_total,
                    output_resource: event.output_resource,
                    output_amount: event.output_amount,
                    output_total: event.output_total,
                },
            )
            .await;
        }
        for event in outcome.item_feed_events {
            record_journal(
                &state,
                tick,
                JournalEventKind::ItemFed {
                    player_id: event.player_id,
                    object_id: event.object_id,
                    item_id: event.item_id,
                    item_label: event.item_label,
                    input_amount: event.input_amount,
                    input_total: event.input_total,
                    output_resource: event.output_resource,
                    output_amount: event.output_amount,
                    output_total: event.output_total,
                },
            )
            .await;
        }
        for event in outcome.item_decay_events {
            record_journal(
                &state,
                tick,
                JournalEventKind::ItemDecayed {
                    player_id: event.player_id,
                    target_object_id: event.target_object_id,
                    item_id: event.item_id,
                    item_label: event.item_label,
                    item_stage: event.item_stage,
                    output_resource: event.output_resource,
                    output_amount: event.output_amount,
                    output_total: event.output_total,
                },
            )
            .await;
        }
        for event in outcome.resource_node_events {
            record_journal(
                &state,
                tick,
                JournalEventKind::ResourceNodeChanged {
                    object_id: event.object_id,
                    resource: event.resource,
                    amount: event.amount,
                    max_amount: event.max_amount,
                },
            )
            .await;
        }
        for event in outcome.crafting_events {
            record_journal(
                &state,
                tick,
                JournalEventKind::ItemCrafted {
                    player_id: event.player_id,
                    object_id: event.object_id,
                    item_id: event.item_id,
                    amount: event.amount,
                    total: event.total,
                },
            )
            .await;
        }
        for event in outcome.npc_relocation_events {
            record_journal(
                &state,
                tick,
                JournalEventKind::NpcRelocated {
                    npc_id: event.npc_id,
                    x: event.x,
                    y: event.y,
                },
            )
            .await;
        }
        for event in outcome.npc_party_events {
            crate::npc::notify_party_event(&state, &event).await;
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
            record_journal(&state, tick, kind).await;
        }
        for job in outcome.settlement_jobs {
            let journal_job = job.clone();
            match settlement::enqueue_persisted_job(
                job,
                &state.settlement_tx,
                &state.settlement_ledger,
                &state.settlement_outbox,
                &state.metrics,
            )
            .await
            {
                Ok(()) => {
                    record_journal(
                        &state,
                        tick,
                        JournalEventKind::OwnershipClaimed {
                            job_id: journal_job.job_id,
                            player_id: journal_job.player_id,
                            account_subject: journal_job.account_subject,
                            asset_id: journal_job.asset_id,
                            reason: journal_job.reason,
                        },
                    )
                    .await;
                }
                Err(err) => {
                    error!(%err, job_id = %journal_job.job_id, "failed to persist or queue settlement job");
                    record_journal(
                        &state,
                        tick,
                        JournalEventKind::SettlementPersistenceFailed {
                            job_id: journal_job.job_id,
                            player_id: journal_job.player_id,
                            account_subject: journal_job.account_subject,
                            asset_id: journal_job.asset_id,
                            error: err.to_string(),
                        },
                    )
                    .await;
                }
            }
        }
        let duration = started_at.elapsed();
        state.metrics.tick_observed(
            duration.as_micros().min(u128::from(u64::MAX)) as u64,
            duration > SERVER_TICK_BUDGET,
        );
    }
}

pub(crate) async fn remove_player(state: &AppState, player_id: PlayerId) {
    let mut sim = state.sim.lock().await;
    sim.remove_player(player_id);
    record_journal(
        state,
        sim.tick_count(),
        JournalEventKind::PlayerLeft { player_id },
    )
    .await;
}

pub(crate) async fn record_journal(state: &AppState, tick: u64, kind: JournalEventKind) {
    let event = state.journal.lock().await.record(tick, kind);
    if let Err(err) = state.journal_writer.lock().await.append(&event) {
        state.metrics.durable_journal_persist_failed();
        error!(%err, "failed to persist journal event");
    }
}
