use super::{append_metric, RuntimeMetricValues};
use crate::AppState;

pub(super) fn append_session_metrics(
    output: &mut String,
    state: &AppState,
    values: &RuntimeMetricValues,
) {
    append_metric(
        output,
        "sundermere_session_pending_tickets",
        "Pending WebSocket session tickets.",
        "gauge",
        values.pending_session_tickets as u64,
    );
    append_metric(
        output,
        "sundermere_session_ticket_capacity",
        "Maximum pending WebSocket session tickets.",
        "gauge",
        values.session_ticket_capacity as u64,
    );
    append_metric(
        output,
        "sundermere_session_issue_rate_limit_per_minute",
        "Configured session ticket issue rate limit per client IP.",
        "gauge",
        state
            .session_issue_rate_limit_config
            .requests_per_minute
            .into(),
    );
    append_metric(
        output,
        "sundermere_session_issue_rate_limit_burst",
        "Configured session ticket issue burst capacity per client IP.",
        "gauge",
        state.session_issue_rate_limit_config.burst.into(),
    );
    append_metric(
        output,
        "sundermere_session_issue_rate_limit_clients",
        "Client IP buckets currently tracked by the session issue rate limiter.",
        "gauge",
        values.tracked_session_issue_clients as u64,
    );
    append_metric(
        output,
        "sundermere_session_issue_rate_limit_max_clients",
        "Configured maximum client IP buckets tracked by the session issue rate limiter.",
        "gauge",
        state.session_issue_rate_limit_config.max_clients as u64,
    );
    append_metric(
        output,
        "sundermere_account_session_rate_limit_per_minute",
        "Configured session ticket issue rate limit per authenticated account subject.",
        "gauge",
        state
            .account_session_rate_limit_config
            .requests_per_minute
            .into(),
    );
    append_metric(
        output,
        "sundermere_account_session_rate_limit_burst",
        "Configured session ticket issue burst capacity per authenticated account subject.",
        "gauge",
        state.account_session_rate_limit_config.burst.into(),
    );
    append_metric(
        output,
        "sundermere_account_session_rate_limit_subjects",
        "Account subjects currently tracked by the session issue rate limiter.",
        "gauge",
        values.tracked_account_session_subjects as u64,
    );
    append_metric(
        output,
        "sundermere_account_session_rate_limit_max_subjects",
        "Configured maximum account subjects tracked by the session issue rate limiter.",
        "gauge",
        state.account_session_rate_limit_config.max_clients as u64,
    );
}
