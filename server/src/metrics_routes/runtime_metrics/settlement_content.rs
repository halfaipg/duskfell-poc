use super::{append_metric, RuntimeMetricValues};
use crate::AppState;

pub(super) fn append_settlement_content_metrics(
    output: &mut String,
    state: &AppState,
    values: &RuntimeMetricValues,
) {
    append_metric(
        output,
        "sundermere_settlement_pending_jobs",
        "Settlement jobs awaiting confirmation.",
        "gauge",
        values.settlement_pending_jobs as u64,
    );
    append_metric(
        output,
        "sundermere_settlement_confirmed_jobs",
        "Recent confirmed settlement jobs retained by the ledger.",
        "gauge",
        values.settlement_confirmed_jobs as u64,
    );
    append_metric(
        output,
        "sundermere_settlement_owned_assets",
        "Assets with confirmed ownership receipts.",
        "gauge",
        values.settlement_owned_assets as u64,
    );
    append_metric(
        output,
        "sundermere_settlement_outbox_events",
        "Settlement outbox JSONL events written or replayed.",
        "gauge",
        values.settlement_outbox_events as u64,
    );
    append_metric(
        output,
        "sundermere_settlement_queue_capacity",
        "Available in-process settlement queue slots.",
        "gauge",
        state.settlement_tx.capacity() as u64,
    );
    append_metric(
        output,
        "sundermere_settlement_queue_max_capacity",
        "Configured in-process settlement queue slots.",
        "gauge",
        state.settlement_tx.max_capacity() as u64,
    );
    append_metric(
        output,
        "sundermere_max_settlement_outbox_bytes",
        "Configured maximum durable settlement outbox file bytes accepted at startup.",
        "gauge",
        state.max_settlement_outbox_bytes,
    );
    append_metric(
        output,
        "sundermere_max_durable_line_bytes",
        "Configured maximum JSONL line bytes accepted during durable replay.",
        "gauge",
        state.max_durable_line_bytes as u64,
    );
    append_metric(
        output,
        "sundermere_durable_sync_writes",
        "Whether durable journal and settlement outbox appends call sync_data after flush.",
        "gauge",
        u64::from(state.durable_sync_writes),
    );
    append_metric(
        output,
        "sundermere_content_objects",
        "World content objects loaded at startup.",
        "gauge",
        state.content_manifest.object_count as u64,
    );
    append_metric(
        output,
        "sundermere_max_content_objects",
        "Configured maximum world content objects accepted at startup.",
        "gauge",
        state.max_content_objects as u64,
    );
}
