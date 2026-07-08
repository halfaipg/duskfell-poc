use std::sync::atomic::{AtomicU64, Ordering};

mod admission;
mod durability;
mod prometheus;
mod websocket;

#[derive(Debug, Default)]
pub struct AppMetrics {
    active_connections: AtomicU64,
    ws_connections_total: AtomicU64,
    ws_messages_in_total: AtomicU64,
    ws_messages_rejected_total: AtomicU64,
    ws_messages_rejected_message_too_large_total: AtomicU64,
    ws_messages_rejected_rate_limited_total: AtomicU64,
    ws_messages_rejected_stale_input_sequence_total: AtomicU64,
    ws_messages_rejected_input_sequence_jump_total: AtomicU64,
    ws_messages_rejected_unsupported_binary_total: AtomicU64,
    ws_messages_out_total: AtomicU64,
    ws_snapshots_sent_total: AtomicU64,
    ws_snapshot_payload_rejected_total: AtomicU64,
    ws_snapshot_players_last: AtomicU64,
    ws_snapshot_players_max: AtomicU64,
    ws_snapshot_objects_last: AtomicU64,
    ws_snapshot_objects_max: AtomicU64,
    ws_bytes_out_total: AtomicU64,
    ws_message_bytes_last: AtomicU64,
    ws_message_bytes_max: AtomicU64,
    ws_snapshot_bytes_last: AtomicU64,
    ws_snapshot_bytes_max: AtomicU64,
    ws_send_errors_total: AtomicU64,
    ws_heartbeat_pings_total: AtomicU64,
    ws_idle_timeouts_total: AtomicU64,
    session_tickets_issued_total: AtomicU64,
    session_ticket_rejected_total: AtomicU64,
    session_ticket_capacity_rejected_total: AtomicU64,
    session_request_invalid_total: AtomicU64,
    session_issue_rate_limited_total: AtomicU64,
    session_account_rate_limited_total: AtomicU64,
    session_draining_rejected_total: AtomicU64,
    session_display_name_invalid_total: AtomicU64,
    session_display_name_conflict_total: AtomicU64,
    account_auth_rejected_total: AtomicU64,
    admin_auth_rejected_total: AtomicU64,
    metrics_auth_rejected_total: AtomicU64,
    origin_rejected_total: AtomicU64,
    ws_capacity_rejected_total: AtomicU64,
    ws_peer_capacity_rejected_total: AtomicU64,
    ws_account_capacity_rejected_total: AtomicU64,
    admin_snapshot_payload_rejected_total: AtomicU64,
    durable_journal_persist_failed_total: AtomicU64,
    durable_settlement_persist_failed_total: AtomicU64,
    settlement_queue_full_total: AtomicU64,
    settlement_queue_closed_total: AtomicU64,
    tick_duration_last_us: AtomicU64,
    tick_duration_max_us: AtomicU64,
    tick_overruns_total: AtomicU64,
}

impl AppMetrics {
    pub fn render_prometheus(&self) -> String {
        prometheus::render(self)
    }
}

pub(super) fn update_max(metric: &AtomicU64, observed: u64) {
    let mut current = metric.load(Ordering::Relaxed);
    while observed > current {
        match metric.compare_exchange_weak(current, observed, Ordering::Relaxed, Ordering::Relaxed)
        {
            Ok(_) => break,
            Err(value) => current = value,
        }
    }
}

#[cfg(test)]
mod tests;
