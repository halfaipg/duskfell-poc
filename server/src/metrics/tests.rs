use crate::ingress::IngressRejectReason;

use super::AppMetrics;

#[test]
fn render_prometheus_includes_current_counters() {
    let metrics = AppMetrics::default();
    metrics.connection_opened();
    metrics.message_in();
    metrics.message_rejected();
    metrics.ingress_message_rejected(&IngressRejectReason::MessageTooLarge {
        bytes: 513,
        max: 512,
    });
    metrics.ingress_message_rejected(&IngressRejectReason::RateLimited);
    metrics.ingress_message_rejected(&IngressRejectReason::StaleInputSequence { seq: 7, last: 8 });
    metrics.ingress_message_rejected(&IngressRejectReason::InputSequenceJump {
        seq: 12,
        last: Some(8),
        max_step: 3,
    });
    metrics.ingress_message_rejected(&IngressRejectReason::UnsupportedBinaryFrame { bytes: 4 });
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
    metrics.ws_account_capacity_rejected();
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
    assert!(rendered.contains("sundermere_ws_messages_rejected_total 6"));
    assert!(rendered.contains("sundermere_ws_messages_rejected_message_too_large_total 1"));
    assert!(rendered.contains("sundermere_ws_messages_rejected_rate_limited_total 1"));
    assert!(rendered.contains("sundermere_ws_messages_rejected_stale_input_sequence_total 1"));
    assert!(rendered.contains("sundermere_ws_messages_rejected_input_sequence_jump_total 1"));
    assert!(rendered.contains("sundermere_ws_messages_rejected_unsupported_binary_total 1"));
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
    assert!(rendered.contains("sundermere_ws_account_capacity_rejected_total 1"));
    assert!(rendered.contains("sundermere_admin_snapshot_payload_rejected_total 1"));
    assert!(rendered.contains("sundermere_durable_journal_persist_failed_total 1"));
    assert!(rendered.contains("sundermere_durable_settlement_persist_failed_total 1"));
    assert!(rendered.contains("sundermere_settlement_queue_full_total 1"));
    assert!(rendered.contains("sundermere_settlement_queue_closed_total 1"));
    assert!(rendered.contains("sundermere_tick_duration_last_us 84"));
    assert!(rendered.contains("sundermere_tick_duration_max_us 84"));
    assert!(rendered.contains("sundermere_tick_overruns_total 1"));
}
