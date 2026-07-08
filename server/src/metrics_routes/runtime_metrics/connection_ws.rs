use super::{append_metric, RuntimeMetricValues};
use crate::AppState;

pub(super) fn append_connection_ws_metrics(
    output: &mut String,
    state: &AppState,
    values: &RuntimeMetricValues,
) {
    append_metric(
        output,
        "sundermere_max_active_connections",
        "Configured active WebSocket connection capacity.",
        "gauge",
        state.max_active_connections as u64,
    );
    append_metric(
        output,
        "sundermere_max_connections_per_ip",
        "Configured active WebSocket connection capacity for one peer IP.",
        "gauge",
        state.max_connections_per_ip as u64,
    );
    append_metric(
        output,
        "sundermere_active_connection_ips",
        "Peer IPs with at least one active WebSocket connection.",
        "gauge",
        values.active_connection_ips as u64,
    );
    append_metric(
        output,
        "sundermere_max_connections_per_account",
        "Configured active WebSocket connection capacity for one authenticated account subject.",
        "gauge",
        state.max_connections_per_account as u64,
    );
    append_metric(
        output,
        "sundermere_active_connection_accounts",
        "Authenticated account subjects with at least one active WebSocket connection.",
        "gauge",
        values.active_connection_accounts as u64,
    );
    append_metric(
        output,
        "sundermere_ws_heartbeat_seconds",
        "Configured WebSocket heartbeat interval in seconds.",
        "gauge",
        state.websocket_config.heartbeat_interval.as_secs(),
    );
    append_metric(
        output,
        "sundermere_snapshot_interval_ms",
        "Configured per-client WebSocket snapshot interval in milliseconds.",
        "gauge",
        state.websocket_config.snapshot_interval.as_millis() as u64,
    );
    append_metric(
        output,
        "sundermere_interest_radius_units",
        "Configured WebSocket snapshot interest radius in world units.",
        "gauge",
        state.websocket_config.interest_radius.round() as u64,
    );
    append_metric(
        output,
        "sundermere_max_snapshot_bytes",
        "Configured maximum serialized welcome or snapshot payload size in bytes.",
        "gauge",
        state.max_snapshot_bytes as u64,
    );
    append_metric(
        output,
        "sundermere_max_admin_snapshot_bytes",
        "Configured maximum serialized full admin/debug snapshot response size in bytes.",
        "gauge",
        state.max_admin_snapshot_bytes as u64,
    );
    append_metric(
        output,
        "sundermere_ws_idle_timeout_seconds",
        "Configured WebSocket idle timeout in seconds.",
        "gauge",
        state.websocket_config.idle_timeout.as_secs(),
    );
    append_metric(
        output,
        "sundermere_ws_max_text_bytes",
        "Configured maximum WebSocket text frame size in bytes.",
        "gauge",
        state.ingress_config.max_text_bytes as u64,
    );
    append_metric(
        output,
        "sundermere_ws_message_burst",
        "Configured per-WebSocket accepted message burst before rate limiting.",
        "gauge",
        state.ingress_config.message_burst.into(),
    );
    append_metric(
        output,
        "sundermere_ws_message_refill_per_second",
        "Configured per-WebSocket accepted message token refill rate per second.",
        "gauge",
        state.ingress_config.message_refill_per_second.into(),
    );
    append_metric(
        output,
        "sundermere_ws_max_input_sequence_step",
        "Configured maximum accepted input sequence increment per WebSocket message.",
        "gauge",
        state.ingress_config.max_input_sequence_step,
    );
    append_metric(
        output,
        "sundermere_client_reject_limit",
        "Rejected client message count that closes one WebSocket connection.",
        "gauge",
        state.client_reject_limit as u64,
    );
}
