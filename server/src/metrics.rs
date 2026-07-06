use std::fmt::Write;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Default)]
pub struct AppMetrics {
    active_connections: AtomicU64,
    ws_connections_total: AtomicU64,
    ws_messages_in_total: AtomicU64,
    ws_messages_rejected_total: AtomicU64,
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
    pub fn active_connections(&self) -> u64 {
        self.active_connections.load(Ordering::Relaxed)
    }

    pub fn connection_opened(&self) {
        self.active_connections.fetch_add(1, Ordering::Relaxed);
        self.ws_connections_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn connection_closed(&self) {
        let _ =
            self.active_connections
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                    Some(value.saturating_sub(1))
                });
    }

    pub fn message_in(&self) {
        self.ws_messages_in_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn message_rejected(&self) {
        self.ws_messages_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn message_out(&self, bytes: usize) {
        let bytes = bytes as u64;
        self.ws_messages_out_total.fetch_add(1, Ordering::Relaxed);
        self.ws_bytes_out_total.fetch_add(bytes, Ordering::Relaxed);
        self.ws_message_bytes_last.store(bytes, Ordering::Relaxed);
        update_max(&self.ws_message_bytes_max, bytes);
    }

    pub fn snapshot_out(&self, bytes: usize) {
        let bytes_u64 = bytes as u64;
        self.ws_snapshots_sent_total.fetch_add(1, Ordering::Relaxed);
        self.ws_snapshot_bytes_last
            .store(bytes_u64, Ordering::Relaxed);
        update_max(&self.ws_snapshot_bytes_max, bytes_u64);
        self.message_out(bytes);
    }

    pub fn snapshot_visibility_observed(&self, players: usize, objects: usize) {
        let players = players as u64;
        let objects = objects as u64;
        self.ws_snapshot_players_last
            .store(players, Ordering::Relaxed);
        self.ws_snapshot_objects_last
            .store(objects, Ordering::Relaxed);
        update_max(&self.ws_snapshot_players_max, players);
        update_max(&self.ws_snapshot_objects_max, objects);
    }

    pub fn snapshot_payload_rejected(&self) {
        self.ws_snapshot_payload_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn send_error(&self) {
        self.ws_send_errors_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn heartbeat_ping(&self) {
        self.ws_heartbeat_pings_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn idle_timeout(&self) {
        self.ws_idle_timeouts_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_ticket_issued(&self) {
        self.session_tickets_issued_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_ticket_rejected(&self) {
        self.session_ticket_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_ticket_capacity_rejected(&self) {
        self.session_ticket_capacity_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_request_invalid(&self) {
        self.session_request_invalid_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_issue_rate_limited(&self) {
        self.session_issue_rate_limited_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_account_rate_limited(&self) {
        self.session_account_rate_limited_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_draining_rejected(&self) {
        self.session_draining_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_display_name_invalid(&self) {
        self.session_display_name_invalid_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_display_name_conflict(&self) {
        self.session_display_name_conflict_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn account_auth_rejected(&self) {
        self.account_auth_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn admin_auth_rejected(&self) {
        self.admin_auth_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn metrics_auth_rejected(&self) {
        self.metrics_auth_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn origin_rejected(&self) {
        self.origin_rejected_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn ws_capacity_rejected(&self) {
        self.ws_capacity_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn ws_peer_capacity_rejected(&self) {
        self.ws_peer_capacity_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn admin_snapshot_payload_rejected(&self) {
        self.admin_snapshot_payload_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn durable_journal_persist_failed(&self) {
        self.durable_journal_persist_failed_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn durable_settlement_persist_failed(&self) {
        self.durable_settlement_persist_failed_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn settlement_queue_full(&self) {
        self.settlement_queue_full_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn settlement_queue_closed(&self) {
        self.settlement_queue_closed_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn durable_journal_persist_failed_total(&self) -> u64 {
        self.durable_journal_persist_failed_total
            .load(Ordering::Relaxed)
    }

    pub fn durable_settlement_persist_failed_total(&self) -> u64 {
        self.durable_settlement_persist_failed_total
            .load(Ordering::Relaxed)
    }

    pub fn settlement_queue_full_total(&self) -> u64 {
        self.settlement_queue_full_total.load(Ordering::Relaxed)
    }

    pub fn settlement_queue_closed_total(&self) -> u64 {
        self.settlement_queue_closed_total.load(Ordering::Relaxed)
    }

    pub fn tick_observed(&self, duration_us: u64, overran_budget: bool) {
        self.tick_duration_last_us
            .store(duration_us, Ordering::Relaxed);
        let mut current = self.tick_duration_max_us.load(Ordering::Relaxed);
        while duration_us > current {
            match self.tick_duration_max_us.compare_exchange_weak(
                current,
                duration_us,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(observed) => current = observed,
            }
        }
        if overran_budget {
            self.tick_overruns_total.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn render_prometheus(&self) -> String {
        let active_connections = self.active_connections();
        let ws_connections_total = self.ws_connections_total.load(Ordering::Relaxed);
        let ws_messages_in_total = self.ws_messages_in_total.load(Ordering::Relaxed);
        let ws_messages_rejected_total = self.ws_messages_rejected_total.load(Ordering::Relaxed);
        let ws_messages_out_total = self.ws_messages_out_total.load(Ordering::Relaxed);
        let ws_snapshots_sent_total = self.ws_snapshots_sent_total.load(Ordering::Relaxed);
        let ws_snapshot_payload_rejected_total = self
            .ws_snapshot_payload_rejected_total
            .load(Ordering::Relaxed);
        let ws_snapshot_players_last = self.ws_snapshot_players_last.load(Ordering::Relaxed);
        let ws_snapshot_players_max = self.ws_snapshot_players_max.load(Ordering::Relaxed);
        let ws_snapshot_objects_last = self.ws_snapshot_objects_last.load(Ordering::Relaxed);
        let ws_snapshot_objects_max = self.ws_snapshot_objects_max.load(Ordering::Relaxed);
        let ws_bytes_out_total = self.ws_bytes_out_total.load(Ordering::Relaxed);
        let ws_message_bytes_last = self.ws_message_bytes_last.load(Ordering::Relaxed);
        let ws_message_bytes_max = self.ws_message_bytes_max.load(Ordering::Relaxed);
        let ws_snapshot_bytes_last = self.ws_snapshot_bytes_last.load(Ordering::Relaxed);
        let ws_snapshot_bytes_max = self.ws_snapshot_bytes_max.load(Ordering::Relaxed);
        let ws_send_errors_total = self.ws_send_errors_total.load(Ordering::Relaxed);
        let ws_heartbeat_pings_total = self.ws_heartbeat_pings_total.load(Ordering::Relaxed);
        let ws_idle_timeouts_total = self.ws_idle_timeouts_total.load(Ordering::Relaxed);
        let session_tickets_issued_total =
            self.session_tickets_issued_total.load(Ordering::Relaxed);
        let session_ticket_rejected_total =
            self.session_ticket_rejected_total.load(Ordering::Relaxed);
        let session_ticket_capacity_rejected_total = self
            .session_ticket_capacity_rejected_total
            .load(Ordering::Relaxed);
        let session_request_invalid_total =
            self.session_request_invalid_total.load(Ordering::Relaxed);
        let session_issue_rate_limited_total = self
            .session_issue_rate_limited_total
            .load(Ordering::Relaxed);
        let session_account_rate_limited_total = self
            .session_account_rate_limited_total
            .load(Ordering::Relaxed);
        let session_draining_rejected_total =
            self.session_draining_rejected_total.load(Ordering::Relaxed);
        let session_display_name_invalid_total = self
            .session_display_name_invalid_total
            .load(Ordering::Relaxed);
        let session_display_name_conflict_total = self
            .session_display_name_conflict_total
            .load(Ordering::Relaxed);
        let account_auth_rejected_total = self.account_auth_rejected_total.load(Ordering::Relaxed);
        let admin_auth_rejected_total = self.admin_auth_rejected_total.load(Ordering::Relaxed);
        let metrics_auth_rejected_total = self.metrics_auth_rejected_total.load(Ordering::Relaxed);
        let origin_rejected_total = self.origin_rejected_total.load(Ordering::Relaxed);
        let ws_capacity_rejected_total = self.ws_capacity_rejected_total.load(Ordering::Relaxed);
        let ws_peer_capacity_rejected_total =
            self.ws_peer_capacity_rejected_total.load(Ordering::Relaxed);
        let admin_snapshot_payload_rejected_total = self
            .admin_snapshot_payload_rejected_total
            .load(Ordering::Relaxed);
        let durable_journal_persist_failed_total = self
            .durable_journal_persist_failed_total
            .load(Ordering::Relaxed);
        let durable_settlement_persist_failed_total = self
            .durable_settlement_persist_failed_total
            .load(Ordering::Relaxed);
        let settlement_queue_full_total = self.settlement_queue_full_total.load(Ordering::Relaxed);
        let settlement_queue_closed_total =
            self.settlement_queue_closed_total.load(Ordering::Relaxed);
        let tick_duration_last_us = self.tick_duration_last_us.load(Ordering::Relaxed);
        let tick_duration_max_us = self.tick_duration_max_us.load(Ordering::Relaxed);
        let tick_overruns_total = self.tick_overruns_total.load(Ordering::Relaxed);

        let mut output = String::new();
        write_metric(
            &mut output,
            "sundermere_active_connections",
            "Active WebSocket connections.",
            "gauge",
            active_connections,
        );
        write_metric(
            &mut output,
            "sundermere_ws_connections_total",
            "Total accepted WebSocket connections.",
            "counter",
            ws_connections_total,
        );
        write_metric(
            &mut output,
            "sundermere_ws_messages_in_total",
            "Accepted WebSocket text messages from clients.",
            "counter",
            ws_messages_in_total,
        );
        write_metric(
            &mut output,
            "sundermere_ws_messages_rejected_total",
            "Rejected or invalid WebSocket text messages from clients.",
            "counter",
            ws_messages_rejected_total,
        );
        write_metric(
            &mut output,
            "sundermere_ws_messages_out_total",
            "WebSocket text messages sent to clients.",
            "counter",
            ws_messages_out_total,
        );
        write_metric(
            &mut output,
            "sundermere_ws_snapshots_sent_total",
            "Interest-filtered snapshot messages sent to clients.",
            "counter",
            ws_snapshots_sent_total,
        );
        write_metric(
            &mut output,
            "sundermere_ws_snapshot_payload_rejected_total",
            "Serialized welcome or snapshot payloads rejected because they exceeded the configured byte cap.",
            "counter",
            ws_snapshot_payload_rejected_total,
        );
        write_metric(
            &mut output,
            "sundermere_ws_snapshot_players_last",
            "Players included in the last interest-filtered welcome or snapshot payload.",
            "gauge",
            ws_snapshot_players_last,
        );
        write_metric(
            &mut output,
            "sundermere_ws_snapshot_players_max",
            "Maximum players included in one interest-filtered welcome or snapshot payload since startup.",
            "gauge",
            ws_snapshot_players_max,
        );
        write_metric(
            &mut output,
            "sundermere_ws_snapshot_objects_last",
            "Objects included in the last interest-filtered welcome or snapshot payload.",
            "gauge",
            ws_snapshot_objects_last,
        );
        write_metric(
            &mut output,
            "sundermere_ws_snapshot_objects_max",
            "Maximum objects included in one interest-filtered welcome or snapshot payload since startup.",
            "gauge",
            ws_snapshot_objects_max,
        );
        write_metric(
            &mut output,
            "sundermere_ws_bytes_out_total",
            "Serialized WebSocket text bytes sent to clients.",
            "counter",
            ws_bytes_out_total,
        );
        write_metric(
            &mut output,
            "sundermere_ws_message_bytes_last",
            "Last serialized WebSocket text message size in bytes.",
            "gauge",
            ws_message_bytes_last,
        );
        write_metric(
            &mut output,
            "sundermere_ws_message_bytes_max",
            "Maximum serialized WebSocket text message size observed since startup.",
            "gauge",
            ws_message_bytes_max,
        );
        write_metric(
            &mut output,
            "sundermere_ws_snapshot_bytes_last",
            "Last serialized WebSocket snapshot message size in bytes.",
            "gauge",
            ws_snapshot_bytes_last,
        );
        write_metric(
            &mut output,
            "sundermere_ws_snapshot_bytes_max",
            "Maximum serialized WebSocket snapshot message size observed since startup.",
            "gauge",
            ws_snapshot_bytes_max,
        );
        write_metric(
            &mut output,
            "sundermere_ws_send_errors_total",
            "WebSocket send failures.",
            "counter",
            ws_send_errors_total,
        );
        write_metric(
            &mut output,
            "sundermere_ws_heartbeat_pings_total",
            "WebSocket heartbeat ping frames sent.",
            "counter",
            ws_heartbeat_pings_total,
        );
        write_metric(
            &mut output,
            "sundermere_ws_idle_timeouts_total",
            "WebSocket connections closed after idle timeout.",
            "counter",
            ws_idle_timeouts_total,
        );
        write_metric(
            &mut output,
            "sundermere_session_tickets_issued_total",
            "Session tickets issued by the HTTP admission endpoint.",
            "counter",
            session_tickets_issued_total,
        );
        write_metric(
            &mut output,
            "sundermere_session_ticket_rejected_total",
            "WebSocket upgrades rejected because the session ticket was missing, invalid, or expired.",
            "counter",
            session_ticket_rejected_total,
        );
        write_metric(
            &mut output,
            "sundermere_session_ticket_capacity_rejected_total",
            "Session ticket issue requests rejected because pending ticket capacity was exhausted.",
            "counter",
            session_ticket_capacity_rejected_total,
        );
        write_metric(
            &mut output,
            "sundermere_session_issue_rate_limited_total",
            "Session ticket issue requests rejected by the per-client-IP rate limiter.",
            "counter",
            session_issue_rate_limited_total,
        );
        write_metric(
            &mut output,
            "sundermere_session_account_rate_limited_total",
            "Session ticket issue requests rejected by the per-account-subject rate limiter.",
            "counter",
            session_account_rate_limited_total,
        );
        write_metric(
            &mut output,
            "sundermere_session_draining_rejected_total",
            "Session ticket issue requests rejected because the shard is draining.",
            "counter",
            session_draining_rejected_total,
        );
        write_metric(
            &mut output,
            "sundermere_session_request_invalid_total",
            "Session ticket issue requests rejected because the JSON body did not match the allowed request shape.",
            "counter",
            session_request_invalid_total,
        );
        write_metric(
            &mut output,
            "sundermere_session_display_name_invalid_total",
            "Session ticket issue requests rejected because the requested display name failed validation.",
            "counter",
            session_display_name_invalid_total,
        );
        write_metric(
            &mut output,
            "sundermere_session_display_name_conflict_total",
            "Session ticket issue requests rejected because the requested display name was already pending or active.",
            "counter",
            session_display_name_conflict_total,
        );
        write_metric(
            &mut output,
            "sundermere_account_auth_rejected_total",
            "Session ticket issue requests rejected because account authentication was missing or invalid.",
            "counter",
            account_auth_rejected_total,
        );
        write_metric(
            &mut output,
            "sundermere_admin_auth_rejected_total",
            "Admin/debug HTTP requests rejected because the admin token was missing or invalid.",
            "counter",
            admin_auth_rejected_total,
        );
        write_metric(
            &mut output,
            "sundermere_metrics_auth_rejected_total",
            "Metrics scrape requests rejected because the metrics token was missing or invalid.",
            "counter",
            metrics_auth_rejected_total,
        );
        write_metric(
            &mut output,
            "sundermere_origin_rejected_total",
            "HTTP session or WebSocket upgrade requests rejected by the Origin allowlist.",
            "counter",
            origin_rejected_total,
        );
        write_metric(
            &mut output,
            "sundermere_ws_capacity_rejected_total",
            "WebSocket upgrades rejected because active connection capacity was exhausted.",
            "counter",
            ws_capacity_rejected_total,
        );
        write_metric(
            &mut output,
            "sundermere_ws_peer_capacity_rejected_total",
            "WebSocket upgrades rejected because one peer IP reached its active connection cap.",
            "counter",
            ws_peer_capacity_rejected_total,
        );
        write_metric(
            &mut output,
            "sundermere_admin_snapshot_payload_rejected_total",
            "Full admin/debug snapshot responses rejected because they exceeded the configured byte cap.",
            "counter",
            admin_snapshot_payload_rejected_total,
        );
        write_metric(
            &mut output,
            "sundermere_durable_journal_persist_failed_total",
            "Durable journal append failures observed after startup.",
            "counter",
            durable_journal_persist_failed_total,
        );
        write_metric(
            &mut output,
            "sundermere_durable_settlement_persist_failed_total",
            "Durable settlement outbox append failures observed after startup.",
            "counter",
            durable_settlement_persist_failed_total,
        );
        write_metric(
            &mut output,
            "sundermere_settlement_queue_full_total",
            "Settlement jobs durably appended but not handed to the worker because the in-process queue was full.",
            "counter",
            settlement_queue_full_total,
        );
        write_metric(
            &mut output,
            "sundermere_settlement_queue_closed_total",
            "Settlement jobs durably appended but not handed to the worker because the in-process queue was closed.",
            "counter",
            settlement_queue_closed_total,
        );
        write_metric(
            &mut output,
            "sundermere_tick_duration_last_us",
            "Last authoritative simulation tick work duration in microseconds.",
            "gauge",
            tick_duration_last_us,
        );
        write_metric(
            &mut output,
            "sundermere_tick_duration_max_us",
            "Maximum authoritative simulation tick work duration observed since startup.",
            "gauge",
            tick_duration_max_us,
        );
        write_metric(
            &mut output,
            "sundermere_tick_overruns_total",
            "Authoritative simulation ticks whose work duration exceeded the configured tick budget.",
            "counter",
            tick_overruns_total,
        );
        output
    }
}

fn write_metric(output: &mut String, name: &str, help: &str, metric_type: &str, value: u64) {
    let _ = writeln!(output, "# HELP {name} {help}");
    let _ = writeln!(output, "# TYPE {name} {metric_type}");
    let _ = writeln!(output, "{name} {value}");
}

fn update_max(metric: &AtomicU64, observed: u64) {
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
mod tests {
    use super::AppMetrics;

    #[test]
    fn render_prometheus_includes_current_counters() {
        let metrics = AppMetrics::default();
        metrics.connection_opened();
        metrics.message_in();
        metrics.message_rejected();
        metrics.snapshot_visibility_observed(3, 5);
        metrics.snapshot_out(512);
        metrics.snapshot_payload_rejected();
        metrics.message_out(128);
        metrics.send_error();
        metrics.heartbeat_ping();
        metrics.idle_timeout();
        metrics.session_ticket_issued();
        metrics.session_ticket_rejected();
        metrics.session_ticket_capacity_rejected();
        metrics.session_request_invalid();
        metrics.session_issue_rate_limited();
        metrics.session_account_rate_limited();
        metrics.session_draining_rejected();
        metrics.session_display_name_invalid();
        metrics.session_display_name_conflict();
        metrics.account_auth_rejected();
        metrics.admin_auth_rejected();
        metrics.metrics_auth_rejected();
        metrics.origin_rejected();
        metrics.ws_capacity_rejected();
        metrics.ws_peer_capacity_rejected();
        metrics.admin_snapshot_payload_rejected();
        metrics.durable_journal_persist_failed();
        metrics.durable_settlement_persist_failed();
        metrics.settlement_queue_full();
        metrics.settlement_queue_closed();
        metrics.tick_observed(42, false);
        metrics.tick_observed(84, true);
        metrics.connection_closed();

        let rendered = metrics.render_prometheus();

        assert!(rendered.contains("# TYPE sundermere_active_connections gauge"));
        assert!(rendered.contains("sundermere_active_connections 0"));
        assert!(rendered.contains("sundermere_ws_connections_total 1"));
        assert!(rendered.contains("sundermere_ws_messages_in_total 1"));
        assert!(rendered.contains("sundermere_ws_messages_rejected_total 1"));
        assert!(rendered.contains("sundermere_ws_messages_out_total 2"));
        assert!(rendered.contains("sundermere_ws_snapshots_sent_total 1"));
        assert!(rendered.contains("sundermere_ws_snapshot_payload_rejected_total 1"));
        assert!(rendered.contains("sundermere_ws_snapshot_players_last 3"));
        assert!(rendered.contains("sundermere_ws_snapshot_players_max 3"));
        assert!(rendered.contains("sundermere_ws_snapshot_objects_last 5"));
        assert!(rendered.contains("sundermere_ws_snapshot_objects_max 5"));
        assert!(rendered.contains("sundermere_ws_bytes_out_total 640"));
        assert!(rendered.contains("sundermere_ws_message_bytes_last 128"));
        assert!(rendered.contains("sundermere_ws_message_bytes_max 512"));
        assert!(rendered.contains("sundermere_ws_snapshot_bytes_last 512"));
        assert!(rendered.contains("sundermere_ws_snapshot_bytes_max 512"));
        assert!(rendered.contains("sundermere_ws_send_errors_total 1"));
        assert!(rendered.contains("sundermere_ws_heartbeat_pings_total 1"));
        assert!(rendered.contains("sundermere_ws_idle_timeouts_total 1"));
        assert!(rendered.contains("sundermere_session_tickets_issued_total 1"));
        assert!(rendered.contains("sundermere_session_ticket_rejected_total 1"));
        assert!(rendered.contains("sundermere_session_ticket_capacity_rejected_total 1"));
        assert!(rendered.contains("sundermere_session_request_invalid_total 1"));
        assert!(rendered.contains("sundermere_session_issue_rate_limited_total 1"));
        assert!(rendered.contains("sundermere_session_account_rate_limited_total 1"));
        assert!(rendered.contains("sundermere_session_draining_rejected_total 1"));
        assert!(rendered.contains("sundermere_session_display_name_invalid_total 1"));
        assert!(rendered.contains("sundermere_session_display_name_conflict_total 1"));
        assert!(rendered.contains("sundermere_account_auth_rejected_total 1"));
        assert!(rendered.contains("sundermere_admin_auth_rejected_total 1"));
        assert!(rendered.contains("sundermere_metrics_auth_rejected_total 1"));
        assert!(rendered.contains("sundermere_origin_rejected_total 1"));
        assert!(rendered.contains("sundermere_ws_capacity_rejected_total 1"));
        assert!(rendered.contains("sundermere_ws_peer_capacity_rejected_total 1"));
        assert!(rendered.contains("sundermere_admin_snapshot_payload_rejected_total 1"));
        assert!(rendered.contains("sundermere_durable_journal_persist_failed_total 1"));
        assert!(rendered.contains("sundermere_durable_settlement_persist_failed_total 1"));
        assert!(rendered.contains("sundermere_settlement_queue_full_total 1"));
        assert!(rendered.contains("sundermere_settlement_queue_closed_total 1"));
        assert!(rendered.contains("sundermere_tick_duration_last_us 84"));
        assert!(rendered.contains("sundermere_tick_duration_max_us 84"));
        assert!(rendered.contains("sundermere_tick_overruns_total 1"));
    }
}
