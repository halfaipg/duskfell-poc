use std::sync::atomic::Ordering;

use super::super::AppMetrics;
use super::write_metric;

pub(super) fn write_websocket_metrics(output: &mut String, metrics: &AppMetrics) {
    write_metric(
        output,
        "sundermere_active_connections",
        "Active WebSocket connections.",
        "gauge",
        metrics.active_connections(),
    );
    write_metric(
        output,
        "sundermere_ws_connections_total",
        "Total accepted WebSocket connections.",
        "counter",
        metrics.ws_connections_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_messages_in_total",
        "Accepted WebSocket text messages from clients.",
        "counter",
        metrics.ws_messages_in_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_messages_rejected_total",
        "Rejected or invalid WebSocket client messages and frames.",
        "counter",
        metrics.ws_messages_rejected_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_messages_rejected_message_too_large_total",
        "WebSocket client messages rejected because the text frame exceeded the configured byte cap.",
        "counter",
        metrics
            .ws_messages_rejected_message_too_large_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_messages_rejected_rate_limited_total",
        "WebSocket client messages rejected by the per-connection token bucket.",
        "counter",
        metrics
            .ws_messages_rejected_rate_limited_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_messages_rejected_stale_input_sequence_total",
        "WebSocket input messages rejected because their sequence number was not newer than the previous input.",
        "counter",
        metrics
            .ws_messages_rejected_stale_input_sequence_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_messages_rejected_input_sequence_jump_total",
        "WebSocket input messages rejected because their sequence number jumped beyond the configured per-message step.",
        "counter",
        metrics
            .ws_messages_rejected_input_sequence_jump_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_messages_rejected_unsupported_binary_total",
        "WebSocket binary frames rejected because the client protocol only accepts text JSON messages.",
        "counter",
        metrics
            .ws_messages_rejected_unsupported_binary_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_messages_out_total",
        "WebSocket text messages sent to clients.",
        "counter",
        metrics.ws_messages_out_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_snapshots_sent_total",
        "Interest-filtered snapshot messages sent to clients.",
        "counter",
        metrics.ws_snapshots_sent_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_snapshot_payload_rejected_total",
        "Serialized welcome or snapshot payloads rejected because they exceeded the configured byte cap.",
        "counter",
        metrics
            .ws_snapshot_payload_rejected_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_snapshot_players_last",
        "Players included in the last interest-filtered welcome or snapshot payload.",
        "gauge",
        metrics.ws_snapshot_players_last.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_snapshot_players_max",
        "Maximum players included in one interest-filtered welcome or snapshot payload since startup.",
        "gauge",
        metrics.ws_snapshot_players_max.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_snapshot_objects_last",
        "Objects included in the last interest-filtered welcome or snapshot payload.",
        "gauge",
        metrics.ws_snapshot_objects_last.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_snapshot_objects_max",
        "Maximum objects included in one interest-filtered welcome or snapshot payload since startup.",
        "gauge",
        metrics.ws_snapshot_objects_max.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_bytes_out_total",
        "Serialized WebSocket text bytes sent to clients.",
        "counter",
        metrics.ws_bytes_out_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_message_bytes_last",
        "Last serialized WebSocket text message size in bytes.",
        "gauge",
        metrics.ws_message_bytes_last.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_message_bytes_max",
        "Maximum serialized WebSocket text message size observed since startup.",
        "gauge",
        metrics.ws_message_bytes_max.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_snapshot_bytes_last",
        "Last serialized WebSocket snapshot message size in bytes.",
        "gauge",
        metrics.ws_snapshot_bytes_last.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_snapshot_bytes_max",
        "Maximum serialized WebSocket snapshot message size observed since startup.",
        "gauge",
        metrics.ws_snapshot_bytes_max.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_npc_say_frames_total",
        "npcSay dialogue frames delivered to player socket channels.",
        "counter",
        metrics.npc_say_frames_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_npc_say_dropped_total",
        "npcSay dialogue frames dropped because the target player was gone or their channel was full.",
        "counter",
        metrics.npc_say_dropped_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_send_errors_total",
        "WebSocket send failures.",
        "counter",
        metrics.ws_send_errors_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_heartbeat_pings_total",
        "WebSocket heartbeat ping frames sent.",
        "counter",
        metrics.ws_heartbeat_pings_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_idle_timeouts_total",
        "WebSocket connections closed after idle timeout.",
        "counter",
        metrics.ws_idle_timeouts_total.load(Ordering::Relaxed),
    );
}
