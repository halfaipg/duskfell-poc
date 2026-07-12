mod connection_ws;
mod deployment_auth;
mod session;
mod settlement_content;
mod sim_journal;

use crate::AppState;

pub(crate) async fn render_runtime_metrics(state: &AppState) -> String {
    let (tick, players) = {
        let sim = state.sim.lock().await;
        (sim.tick_count(), sim.player_count())
    };
    let settlement = state
        .settlement_ledger
        .lock()
        .await
        .snapshot(state.settlement_config.chain_enabled);
    let (journal_events, journal_retained_capacity, journal_last_sequence) = {
        let journal = state.journal.lock().await;
        (
            journal.retained_events(),
            journal.retained_capacity(),
            journal.last_sequence(),
        )
    };
    let settlement_outbox_events = state.settlement_outbox.lock().await.events_written();
    let (pending_session_tickets, session_ticket_capacity) = {
        let mut sessions = state.sessions.lock().await;
        (sessions.pending_count(), sessions.capacity())
    };
    let tracked_session_issue_clients = state.session_issue_limiter.lock().await.tracked_clients();
    let tracked_account_session_subjects = state
        .account_session_limiter
        .lock()
        .await
        .tracked_subjects();
    let active_connection_accounts = state.account_connections.lock().await.active_accounts();
    let active_connection_ips = state.peer_connections.lock().await.active_ips();

    let values = RuntimeMetricValues {
        tick,
        players,
        journal_events,
        journal_retained_capacity,
        journal_last_sequence,
        settlement_pending_jobs: settlement.pending_jobs,
        settlement_confirmed_jobs: settlement.confirmed_jobs,
        settlement_owned_assets: settlement.owned_assets,
        settlement_outbox_events,
        pending_session_tickets,
        session_ticket_capacity,
        tracked_session_issue_clients,
        tracked_account_session_subjects,
        active_connection_accounts,
        active_connection_ips,
    };

    let mut metrics = state.metrics.render_prometheus();

    sim_journal::append_sim_journal_metrics(&mut metrics, state, &values);
    settlement_content::append_settlement_content_metrics(&mut metrics, state, &values);
    session::append_session_metrics(&mut metrics, state, &values);
    connection_ws::append_connection_ws_metrics(&mut metrics, state, &values);
    deployment_auth::append_deployment_auth_metrics(&mut metrics, state, &values);
    append_animus_metrics(&mut metrics, state).await;

    metrics
}

async fn append_animus_metrics(output: &mut String, state: &AppState) {
    let Some(bridge) = &state.npc_engine else {
        return;
    };
    let snapshot = bridge.metrics.snapshot();
    let degraded = matches!(
        &*bridge.status.lock().await,
        animus::EngineStatus::Degraded { .. }
    );
    append_metric(
        output,
        "animus_requests_total",
        "Provider completion requests issued by the NPC cognition engine.",
        "counter",
        snapshot.requests_total,
    );
    append_metric(
        output,
        "animus_tokens_total",
        "Provider tokens consumed by NPC cognition (usage-reported or estimated).",
        "counter",
        snapshot.tokens_total,
    );
    append_metric(
        output,
        "animus_fallbacks_total",
        "Cognition jobs answered with a deterministic fallback (timeout, budget, queue, provider down).",
        "counter",
        snapshot.fallbacks_total,
    );
    append_metric(
        output,
        "animus_dropped_jobs_total",
        "Cognition jobs dropped before processing (queue overflow).",
        "counter",
        snapshot.dropped_jobs_total,
    );
    append_metric(
        output,
        "animus_schema_retries_total",
        "Model responses that failed intent-schema validation and were retried once.",
        "counter",
        snapshot.schema_retries_total,
    );
    append_metric(
        output,
        "animus_provider_degraded",
        "1 when the cognition provider is degraded (NPCs answer canned), else 0.",
        "gauge",
        u64::from(degraded),
    );
}

#[derive(Debug, Clone, Copy)]
pub(super) struct RuntimeMetricValues {
    tick: u64,
    players: usize,
    journal_events: usize,
    journal_retained_capacity: usize,
    journal_last_sequence: u64,
    settlement_pending_jobs: usize,
    settlement_confirmed_jobs: usize,
    settlement_owned_assets: usize,
    settlement_outbox_events: usize,
    pending_session_tickets: usize,
    session_ticket_capacity: usize,
    tracked_session_issue_clients: usize,
    tracked_account_session_subjects: usize,
    active_connection_accounts: usize,
    active_connection_ips: usize,
}

pub(super) fn append_metric(
    output: &mut String,
    name: &str,
    help: &str,
    metric_type: &str,
    value: u64,
) {
    use std::fmt::Write as _;

    let _ = writeln!(output, "# HELP {name} {help}");
    let _ = writeln!(output, "# TYPE {name} {metric_type}");
    let _ = writeln!(output, "{name} {value}");
}
