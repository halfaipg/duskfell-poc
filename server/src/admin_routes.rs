use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Serialize;

use crate::auth::authorize_admin;
use crate::content::ContentManifest;
use crate::journal::JournalEvent;
use crate::protocol::SettlementReceiptSnapshot;
use crate::readiness::redacted_durable_path_basename;
use crate::runtime_assets::RuntimeManifest;
use crate::{AppState, DEFAULT_ADMIN_EVENT_LIMIT, SERVER_TICK_BUDGET};

#[derive(Debug, serde::Deserialize)]
pub(crate) struct EventQuery {
    limit: Option<usize>,
    after: Option<u64>,
}

pub(crate) async fn admin_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<EventQuery>,
) -> Result<Json<Vec<JournalEvent>>, (StatusCode, String)> {
    authorize_admin(&state, &headers)?;
    let requested_limit = query.limit.unwrap_or(DEFAULT_ADMIN_EVENT_LIMIT);
    let limit = requested_limit.min(state.admin_event_limit_cap);
    let events = {
        let journal = state.journal.lock().await;
        match query.after {
            Some(sequence) => journal.after(sequence, limit),
            None => journal.recent(limit),
        }
    };
    Ok(Json(events))
}

pub(crate) async fn admin_ownership(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<SettlementReceiptSnapshot>>, (StatusCode, String)> {
    authorize_admin(&state, &headers)?;
    Ok(Json(state.settlement_ledger.lock().await.ownership()))
}

pub(crate) async fn admin_runtime(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<RuntimeManifest>, (StatusCode, String)> {
    authorize_admin(&state, &headers)?;
    Ok(Json(state.runtime_manifest.clone()))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminSummary {
    tick: u64,
    players: usize,
    journal_events: usize,
    journal_retained_capacity: usize,
    journal_replayed_total_events: usize,
    journal_last_sequence: u64,
    journal_sequence_anomalies: usize,
    journal_path: String,
    max_journal_bytes: u64,
    max_content_objects: usize,
    settlement_pending: usize,
    settlement_confirmed: usize,
    settlement_owned_assets: usize,
    settlement_outbox_path: String,
    settlement_outbox_events: usize,
    settlement_queue_capacity: usize,
    settlement_queue_max_capacity: usize,
    settlement_queue_full_events: u64,
    settlement_queue_closed_events: u64,
    max_settlement_outbox_bytes: u64,
    max_durable_line_bytes: usize,
    persistence_backend: &'static str,
    durable_sync_writes: bool,
    durable_journal_persist_failures: u64,
    durable_settlement_persist_failures: u64,
    chain_enabled: bool,
    active_connections: u64,
    max_active_connections: usize,
    max_connections_per_ip: usize,
    active_connection_ips: usize,
    max_connections_per_account: usize,
    active_connection_accounts: usize,
    tick_budget_us: u64,
    snapshot_interval_ms: u64,
    interest_radius_units: f32,
    max_snapshot_bytes: usize,
    max_admin_snapshot_bytes: usize,
    websocket_heartbeat_seconds: u64,
    websocket_idle_timeout_seconds: u64,
    websocket_max_text_bytes: usize,
    websocket_message_burst: u32,
    websocket_message_refill_per_second: u32,
    websocket_max_input_sequence_step: u64,
    client_reject_limit: usize,
    origin_allowlist_enabled: bool,
    origin_allowed_count: usize,
    deployment_profile: &'static str,
    public_deployment: bool,
    admission_backend: &'static str,
    draining: bool,
    require_session: bool,
    require_account: bool,
    account_auth_mode: &'static str,
    dev_account_token_configured: bool,
    account_jwt_issuer_configured: bool,
    account_jwt_audience_configured: bool,
    session_pending_tickets: usize,
    session_ticket_capacity: usize,
    session_issue_rate_limit_per_minute: u32,
    session_issue_rate_limit_burst: u32,
    session_issue_rate_limit_clients: usize,
    session_issue_rate_limit_max_clients: usize,
    account_session_rate_limit_per_minute: u32,
    account_session_rate_limit_burst: u32,
    account_session_rate_limit_subjects: usize,
    account_session_rate_limit_max_subjects: usize,
    http_body_limit_bytes: usize,
    admin_event_limit_cap: usize,
    content: ContentManifest,
}

pub(crate) async fn admin_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AdminSummary>, (StatusCode, String)> {
    authorize_admin(&state, &headers)?;
    let sim = state.sim.lock().await;
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
    let journal_path = {
        let writer = state.journal_writer.lock().await;
        redacted_durable_path_basename(writer.path())
    };
    let (settlement_outbox_path, settlement_outbox_events) = {
        let outbox = state.settlement_outbox.lock().await;
        (
            redacted_durable_path_basename(outbox.path()),
            outbox.events_written(),
        )
    };
    let (session_pending_tickets, session_ticket_capacity) = {
        let mut sessions = state.sessions.lock().await;
        (sessions.pending_count(), sessions.capacity())
    };
    let session_issue_rate_limit_clients =
        state.session_issue_limiter.lock().await.tracked_clients();
    let account_session_rate_limit_subjects = state
        .account_session_limiter
        .lock()
        .await
        .tracked_subjects();
    let active_connection_ips = state.peer_connections.lock().await.active_ips();
    let active_connection_accounts = state.account_connections.lock().await.active_accounts();

    Ok(Json(AdminSummary {
        tick: sim.tick_count(),
        players: sim.player_count(),
        journal_events,
        journal_retained_capacity,
        journal_replayed_total_events: state.journal_replayed_total_events,
        journal_last_sequence,
        journal_sequence_anomalies: state.journal_sequence_anomalies,
        journal_path,
        max_journal_bytes: state.max_journal_bytes,
        max_content_objects: state.max_content_objects,
        settlement_pending: settlement.pending_jobs,
        settlement_confirmed: settlement.confirmed_jobs,
        settlement_owned_assets: settlement.owned_assets,
        settlement_outbox_path,
        settlement_outbox_events,
        settlement_queue_capacity: state.settlement_tx.capacity(),
        settlement_queue_max_capacity: state.settlement_tx.max_capacity(),
        settlement_queue_full_events: state.metrics.settlement_queue_full_total(),
        settlement_queue_closed_events: state.metrics.settlement_queue_closed_total(),
        max_settlement_outbox_bytes: state.max_settlement_outbox_bytes,
        max_durable_line_bytes: state.max_durable_line_bytes,
        persistence_backend: state.persistence_backend.name(),
        durable_sync_writes: state.durable_sync_writes,
        durable_journal_persist_failures: state.metrics.durable_journal_persist_failed_total(),
        durable_settlement_persist_failures: state
            .metrics
            .durable_settlement_persist_failed_total(),
        chain_enabled: state.settlement_config.chain_enabled,
        active_connections: state.metrics.active_connections(),
        max_active_connections: state.max_active_connections,
        max_connections_per_ip: state.max_connections_per_ip,
        active_connection_ips,
        max_connections_per_account: state.max_connections_per_account,
        active_connection_accounts,
        tick_budget_us: SERVER_TICK_BUDGET.as_micros() as u64,
        snapshot_interval_ms: state.websocket_config.snapshot_interval.as_millis() as u64,
        interest_radius_units: state.websocket_config.interest_radius,
        max_snapshot_bytes: state.max_snapshot_bytes,
        max_admin_snapshot_bytes: state.max_admin_snapshot_bytes,
        websocket_heartbeat_seconds: state.websocket_config.heartbeat_interval.as_secs(),
        websocket_idle_timeout_seconds: state.websocket_config.idle_timeout.as_secs(),
        websocket_max_text_bytes: state.ingress_config.max_text_bytes,
        websocket_message_burst: state.ingress_config.message_burst,
        websocket_message_refill_per_second: state.ingress_config.message_refill_per_second,
        websocket_max_input_sequence_step: state.ingress_config.max_input_sequence_step,
        client_reject_limit: state.client_reject_limit,
        origin_allowlist_enabled: state.origin_allowlist.enabled(),
        origin_allowed_count: state.origin_allowlist.allowed_count(),
        deployment_profile: state.deployment_profile.name(),
        public_deployment: state.public_deployment,
        admission_backend: state.admission_backend.name(),
        draining: state.draining,
        require_session: state.session_config.require_session,
        require_account: state.account_auth.require_account,
        account_auth_mode: state.account_auth.mode_name(),
        dev_account_token_configured: state.account_auth.dev_account_token_configured(),
        account_jwt_issuer_configured: state.account_auth.jwt_issuer_configured(),
        account_jwt_audience_configured: state.account_auth.jwt_audience_configured(),
        session_pending_tickets,
        session_ticket_capacity,
        session_issue_rate_limit_per_minute: state
            .session_issue_rate_limit_config
            .requests_per_minute,
        session_issue_rate_limit_burst: state.session_issue_rate_limit_config.burst,
        session_issue_rate_limit_clients,
        session_issue_rate_limit_max_clients: state.session_issue_rate_limit_config.max_clients,
        account_session_rate_limit_per_minute: state
            .account_session_rate_limit_config
            .requests_per_minute,
        account_session_rate_limit_burst: state.account_session_rate_limit_config.burst,
        account_session_rate_limit_subjects,
        account_session_rate_limit_max_subjects: state
            .account_session_rate_limit_config
            .max_clients,
        http_body_limit_bytes: state.http_body_limit_bytes,
        admin_event_limit_cap: state.admin_event_limit_cap,
        content: state.content_manifest.clone(),
    }))
}
