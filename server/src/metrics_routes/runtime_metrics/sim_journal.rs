use super::{append_metric, RuntimeMetricValues};
use crate::{AppState, SERVER_TICK_BUDGET};

pub(super) fn append_sim_journal_metrics(
    output: &mut String,
    state: &AppState,
    values: &RuntimeMetricValues,
) {
    append_metric(
        output,
        "sundermere_tick",
        "Authoritative simulation tick.",
        "gauge",
        values.tick,
    );
    append_metric(
        output,
        "sundermere_tick_budget_us",
        "Configured authoritative simulation tick work budget in microseconds.",
        "gauge",
        SERVER_TICK_BUDGET.as_micros() as u64,
    );
    append_metric(
        output,
        "sundermere_players",
        "Players currently present in the simulation.",
        "gauge",
        values.players as u64,
    );
    append_metric(
        output,
        "sundermere_journal_events",
        "In-memory journal events retained for admin inspection.",
        "gauge",
        values.journal_events as u64,
    );
    append_metric(
        output,
        "sundermere_journal_retained_capacity",
        "Maximum in-memory journal events retained for admin inspection.",
        "gauge",
        values.journal_retained_capacity as u64,
    );
    append_metric(
        output,
        "sundermere_journal_replayed_total_events",
        "Journal events found in the durable JSONL file at startup.",
        "gauge",
        state.journal_replayed_total_events as u64,
    );
    append_metric(
        output,
        "sundermere_journal_last_sequence",
        "Last journal sequence value seen after replayed and recorded events.",
        "gauge",
        values.journal_last_sequence,
    );
    append_metric(
        output,
        "sundermere_journal_sequence_anomalies",
        "Non-increasing journal sequence observations found during startup replay.",
        "gauge",
        state.journal_sequence_anomalies as u64,
    );
    append_metric(
        output,
        "sundermere_max_journal_bytes",
        "Configured maximum durable journal file bytes accepted at startup.",
        "gauge",
        state.max_journal_bytes,
    );
}
