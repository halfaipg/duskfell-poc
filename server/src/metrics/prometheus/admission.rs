use std::sync::atomic::Ordering;

use super::super::AppMetrics;
use super::write_metric;

pub(super) fn write_admission_metrics(output: &mut String, metrics: &AppMetrics) {
    write_metric(
        output,
        "sundermere_session_tickets_issued_total",
        "Session tickets issued by the HTTP admission endpoint.",
        "counter",
        metrics.session_tickets_issued_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_session_ticket_rejected_total",
        "WebSocket upgrades rejected because the session ticket was missing, invalid, or expired.",
        "counter",
        metrics
            .session_ticket_rejected_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_session_ticket_capacity_rejected_total",
        "Session ticket issue requests rejected because pending ticket capacity was exhausted.",
        "counter",
        metrics
            .session_ticket_capacity_rejected_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_session_issue_rate_limited_total",
        "Session ticket issue requests rejected by the per-client-IP rate limiter.",
        "counter",
        metrics
            .session_issue_rate_limited_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_session_account_rate_limited_total",
        "Session ticket issue requests rejected by the per-account-subject rate limiter.",
        "counter",
        metrics
            .session_account_rate_limited_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_session_draining_rejected_total",
        "Session or WebSocket admission requests rejected because the shard is draining.",
        "counter",
        metrics
            .session_draining_rejected_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_session_request_invalid_total",
        "Session ticket issue requests rejected because the JSON body did not match the allowed request shape.",
        "counter",
        metrics.session_request_invalid_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_session_display_name_invalid_total",
        "Session ticket issue requests rejected because the requested display name failed validation.",
        "counter",
        metrics
            .session_display_name_invalid_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_session_display_name_conflict_total",
        "Session ticket issue requests rejected because the requested display name was already pending or active.",
        "counter",
        metrics
            .session_display_name_conflict_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_account_auth_rejected_total",
        "Session ticket issue requests rejected because account authentication was missing or invalid.",
        "counter",
        metrics.account_auth_rejected_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_admin_auth_rejected_total",
        "Admin/debug HTTP requests rejected because the admin token was missing or invalid.",
        "counter",
        metrics.admin_auth_rejected_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_metrics_auth_rejected_total",
        "Metrics scrape requests rejected because the metrics token was missing or invalid.",
        "counter",
        metrics.metrics_auth_rejected_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_origin_rejected_total",
        "HTTP session or WebSocket upgrade requests rejected by the Origin allowlist.",
        "counter",
        metrics.origin_rejected_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_capacity_rejected_total",
        "WebSocket upgrades rejected because active connection capacity was exhausted.",
        "counter",
        metrics.ws_capacity_rejected_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_peer_capacity_rejected_total",
        "WebSocket upgrades rejected because one peer IP reached its active connection cap.",
        "counter",
        metrics
            .ws_peer_capacity_rejected_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_ws_account_capacity_rejected_total",
        "WebSocket upgrades rejected because one authenticated account reached its active connection cap.",
        "counter",
        metrics
            .ws_account_capacity_rejected_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_admin_snapshot_payload_rejected_total",
        "Full admin/debug snapshot responses rejected because they exceeded the configured byte cap.",
        "counter",
        metrics
            .admin_snapshot_payload_rejected_total
            .load(Ordering::Relaxed),
    );
}
