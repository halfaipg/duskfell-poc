use std::sync::atomic::Ordering;

use super::super::AppMetrics;
use super::write_metric;

pub(super) fn write_durability_metrics(output: &mut String, metrics: &AppMetrics) {
    write_metric(
        output,
        "sundermere_durable_journal_persist_failed_total",
        "Durable journal append failures observed after startup.",
        "counter",
        metrics
            .durable_journal_persist_failed_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_durable_settlement_persist_failed_total",
        "Durable settlement outbox append failures observed after startup.",
        "counter",
        metrics
            .durable_settlement_persist_failed_total
            .load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_settlement_queue_full_total",
        "Settlement jobs durably appended but not handed to the worker because the in-process queue was full.",
        "counter",
        metrics.settlement_queue_full_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_settlement_queue_closed_total",
        "Settlement jobs durably appended but not handed to the worker because the in-process queue was closed.",
        "counter",
        metrics.settlement_queue_closed_total.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_tick_duration_last_us",
        "Last authoritative simulation tick work duration in microseconds.",
        "gauge",
        metrics.tick_duration_last_us.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_tick_duration_max_us",
        "Maximum authoritative simulation tick work duration observed since startup.",
        "gauge",
        metrics.tick_duration_max_us.load(Ordering::Relaxed),
    );
    write_metric(
        output,
        "sundermere_tick_overruns_total",
        "Authoritative simulation ticks whose work duration exceeded the configured tick budget.",
        "counter",
        metrics.tick_overruns_total.load(Ordering::Relaxed),
    );
}
