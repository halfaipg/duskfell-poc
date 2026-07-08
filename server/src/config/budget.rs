use crate::ingress::ClientIngressConfig;
use crate::session::{SessionConfig, SessionIssueRateLimitConfig};
use anyhow::anyhow;

use super::WebSocketConfig;

const MAX_RUNTIME_ACTIVE_CONNECTIONS: usize = 10_000;
const MAX_RUNTIME_CONNECTIONS_PER_IP: usize = 10_000;
const MAX_RUNTIME_CONNECTIONS_PER_ACCOUNT: usize = 1_000;
const MAX_RUNTIME_SESSION_TICKET_CAPACITY: usize = 100_000;
const MAX_RUNTIME_SESSION_TICKET_TTL_SECONDS: u64 = 3_600;
const MAX_RUNTIME_SESSION_RATE_LIMIT_PER_MINUTE: u32 = 60_000;
const MAX_RUNTIME_SESSION_RATE_LIMIT_BURST: u32 = 10_000;
const MAX_RUNTIME_SESSION_RATE_LIMIT_BUCKETS: usize = 100_000;
const MIN_RUNTIME_WS_TEXT_BYTES: usize = 128;
const MAX_RUNTIME_WS_TEXT_BYTES: usize = 65_536;
const MAX_RUNTIME_WS_MESSAGE_BURST: u32 = 1_000;
const MAX_RUNTIME_WS_MESSAGE_REFILL_PER_SECOND: u32 = 1_000;
const MAX_RUNTIME_INPUT_SEQUENCE_STEP: u64 = 100_000;
const MAX_RUNTIME_CLIENT_REJECT_LIMIT: usize = 100;
const MAX_RUNTIME_SNAPSHOT_INTERVAL_MS: u64 = 5_000;
const MAX_RUNTIME_INTEREST_RADIUS: f32 = 10_000.0;
const MIN_RUNTIME_SNAPSHOT_BYTES: usize = 1_024;
const MAX_RUNTIME_SNAPSHOT_BYTES: usize = 1_048_576;
const MIN_RUNTIME_ADMIN_SNAPSHOT_BYTES: usize = 1_024;
const MAX_RUNTIME_ADMIN_SNAPSHOT_BYTES: usize = 4_194_304;
const MIN_RUNTIME_HTTP_BODY_LIMIT_BYTES: usize = 256;
const MAX_RUNTIME_HTTP_BODY_LIMIT_BYTES: usize = 1_048_576;
const MIN_RUNTIME_JOURNAL_BYTES: u64 = 1_024;
const MAX_RUNTIME_JOURNAL_BYTES: u64 = 1_073_741_824;
const MIN_RUNTIME_SETTLEMENT_OUTBOX_BYTES: u64 = 1_024;
const MAX_RUNTIME_SETTLEMENT_OUTBOX_BYTES: u64 = 1_073_741_824;
const MIN_RUNTIME_DURABLE_LINE_BYTES: usize = 128;
const MAX_RUNTIME_DURABLE_LINE_BYTES: usize = 1_048_576;
const MIN_RUNTIME_MANIFEST_BYTES: u64 = 1_024;
const MAX_RUNTIME_MANIFEST_BYTES: u64 = 1_048_576;
const MIN_RUNTIME_ASSET_BYTES: usize = 1_024;
const MAX_RUNTIME_ASSET_BYTES: usize = 10_485_760;
const MAX_RUNTIME_CONTENT_OBJECTS: usize = 100_000;
const MAX_RUNTIME_ADMIN_EVENT_LIMIT_CAP: usize = 10_000;

pub(crate) struct RuntimeBudgetConfig {
    pub(crate) session_config: SessionConfig,
    pub(crate) session_issue_rate_limit_config: SessionIssueRateLimitConfig,
    pub(crate) account_session_rate_limit_config: SessionIssueRateLimitConfig,
    pub(crate) websocket_config: WebSocketConfig,
    pub(crate) ingress_config: ClientIngressConfig,
    pub(crate) max_snapshot_bytes: usize,
    pub(crate) max_admin_snapshot_bytes: usize,
    pub(crate) max_active_connections: usize,
    pub(crate) max_connections_per_ip: usize,
    pub(crate) max_connections_per_account: usize,
    pub(crate) http_body_limit_bytes: usize,
    pub(crate) client_reject_limit: usize,
    pub(crate) admin_event_limit_cap: usize,
    pub(crate) max_journal_bytes: u64,
    pub(crate) max_settlement_outbox_bytes: u64,
    pub(crate) max_durable_line_bytes: usize,
    pub(crate) max_runtime_manifest_bytes: u64,
    pub(crate) max_runtime_asset_bytes: usize,
    pub(crate) max_content_objects: usize,
}

pub(crate) fn validate_runtime_budget_config(config: RuntimeBudgetConfig) -> anyhow::Result<()> {
    validate_usize_budget(
        "MAX_ACTIVE_CONNECTIONS",
        config.max_active_connections,
        1,
        MAX_RUNTIME_ACTIVE_CONNECTIONS,
    )?;
    validate_usize_budget(
        "MAX_CONNECTIONS_PER_IP",
        config.max_connections_per_ip,
        1,
        MAX_RUNTIME_CONNECTIONS_PER_IP,
    )?;
    if config.max_connections_per_ip > config.max_active_connections {
        return Err(anyhow!(
            "MAX_CONNECTIONS_PER_IP must be <= MAX_ACTIVE_CONNECTIONS"
        ));
    }
    validate_usize_budget(
        "MAX_CONNECTIONS_PER_ACCOUNT",
        config.max_connections_per_account,
        1,
        MAX_RUNTIME_CONNECTIONS_PER_ACCOUNT,
    )?;
    if config.max_connections_per_account > config.max_active_connections {
        return Err(anyhow!(
            "MAX_CONNECTIONS_PER_ACCOUNT must be <= MAX_ACTIVE_CONNECTIONS"
        ));
    }

    validate_usize_budget(
        "SESSION_TICKET_CAPACITY",
        config.session_config.ticket_capacity,
        1,
        MAX_RUNTIME_SESSION_TICKET_CAPACITY,
    )?;
    validate_u64_budget(
        "SESSION_TICKET_TTL_SECONDS",
        config.session_config.ticket_ttl.as_secs(),
        1,
        MAX_RUNTIME_SESSION_TICKET_TTL_SECONDS,
    )?;

    validate_session_rate_limit_budget(
        "SESSION_ISSUE_RATE_LIMIT",
        &config.session_issue_rate_limit_config,
    )?;
    validate_session_rate_limit_budget(
        "ACCOUNT_SESSION_RATE_LIMIT",
        &config.account_session_rate_limit_config,
    )?;

    validate_usize_budget(
        "WS_MAX_TEXT_BYTES",
        config.ingress_config.max_text_bytes,
        MIN_RUNTIME_WS_TEXT_BYTES,
        MAX_RUNTIME_WS_TEXT_BYTES,
    )?;
    validate_u32_budget(
        "WS_MESSAGE_BURST",
        config.ingress_config.message_burst,
        1,
        MAX_RUNTIME_WS_MESSAGE_BURST,
    )?;
    validate_u32_budget(
        "WS_MESSAGE_REFILL_PER_SECOND",
        config.ingress_config.message_refill_per_second,
        1,
        MAX_RUNTIME_WS_MESSAGE_REFILL_PER_SECOND,
    )?;
    validate_u64_budget(
        "WS_MAX_INPUT_SEQUENCE_STEP",
        config.ingress_config.max_input_sequence_step,
        1,
        MAX_RUNTIME_INPUT_SEQUENCE_STEP,
    )?;
    validate_usize_budget(
        "CLIENT_REJECT_LIMIT",
        config.client_reject_limit,
        1,
        MAX_RUNTIME_CLIENT_REJECT_LIMIT,
    )?;
    validate_u64_budget(
        "SNAPSHOT_INTERVAL_MS",
        config.websocket_config.snapshot_interval.as_millis() as u64,
        1,
        MAX_RUNTIME_SNAPSHOT_INTERVAL_MS,
    )?;
    validate_f32_budget(
        "INTEREST_RADIUS",
        config.websocket_config.interest_radius,
        1.0,
        MAX_RUNTIME_INTEREST_RADIUS,
    )?;
    validate_usize_budget(
        "MAX_SNAPSHOT_BYTES",
        config.max_snapshot_bytes,
        MIN_RUNTIME_SNAPSHOT_BYTES,
        MAX_RUNTIME_SNAPSHOT_BYTES,
    )?;
    validate_usize_budget(
        "MAX_ADMIN_SNAPSHOT_BYTES",
        config.max_admin_snapshot_bytes,
        MIN_RUNTIME_ADMIN_SNAPSHOT_BYTES,
        MAX_RUNTIME_ADMIN_SNAPSHOT_BYTES,
    )?;
    validate_usize_budget(
        "HTTP_BODY_LIMIT_BYTES",
        config.http_body_limit_bytes,
        MIN_RUNTIME_HTTP_BODY_LIMIT_BYTES,
        MAX_RUNTIME_HTTP_BODY_LIMIT_BYTES,
    )?;
    validate_u64_budget(
        "MAX_JOURNAL_BYTES",
        config.max_journal_bytes,
        MIN_RUNTIME_JOURNAL_BYTES,
        MAX_RUNTIME_JOURNAL_BYTES,
    )?;
    validate_u64_budget(
        "MAX_SETTLEMENT_OUTBOX_BYTES",
        config.max_settlement_outbox_bytes,
        MIN_RUNTIME_SETTLEMENT_OUTBOX_BYTES,
        MAX_RUNTIME_SETTLEMENT_OUTBOX_BYTES,
    )?;
    validate_usize_budget(
        "MAX_DURABLE_LINE_BYTES",
        config.max_durable_line_bytes,
        MIN_RUNTIME_DURABLE_LINE_BYTES,
        MAX_RUNTIME_DURABLE_LINE_BYTES,
    )?;
    validate_u64_budget(
        "MAX_RUNTIME_MANIFEST_BYTES",
        config.max_runtime_manifest_bytes,
        MIN_RUNTIME_MANIFEST_BYTES,
        MAX_RUNTIME_MANIFEST_BYTES,
    )?;
    validate_usize_budget(
        "MAX_RUNTIME_ASSET_BYTES",
        config.max_runtime_asset_bytes,
        MIN_RUNTIME_ASSET_BYTES,
        MAX_RUNTIME_ASSET_BYTES,
    )?;
    validate_usize_budget(
        "MAX_CONTENT_OBJECTS",
        config.max_content_objects,
        1,
        MAX_RUNTIME_CONTENT_OBJECTS,
    )?;
    validate_usize_budget(
        "ADMIN_EVENT_LIMIT_CAP",
        config.admin_event_limit_cap,
        1,
        MAX_RUNTIME_ADMIN_EVENT_LIMIT_CAP,
    )?;

    Ok(())
}

fn validate_session_rate_limit_budget(
    prefix: &'static str,
    config: &SessionIssueRateLimitConfig,
) -> anyhow::Result<()> {
    validate_u32_budget(
        match prefix {
            "SESSION_ISSUE_RATE_LIMIT" => "SESSION_ISSUE_RATE_LIMIT_PER_MINUTE",
            _ => "ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE",
        },
        config.requests_per_minute,
        1,
        MAX_RUNTIME_SESSION_RATE_LIMIT_PER_MINUTE,
    )?;
    validate_u32_budget(
        match prefix {
            "SESSION_ISSUE_RATE_LIMIT" => "SESSION_ISSUE_RATE_LIMIT_BURST",
            _ => "ACCOUNT_SESSION_RATE_LIMIT_BURST",
        },
        config.burst,
        1,
        MAX_RUNTIME_SESSION_RATE_LIMIT_BURST,
    )?;
    validate_usize_budget(
        match prefix {
            "SESSION_ISSUE_RATE_LIMIT" => "SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS",
            _ => "ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS",
        },
        config.max_clients,
        1,
        MAX_RUNTIME_SESSION_RATE_LIMIT_BUCKETS,
    )?;
    if config.burst > config.requests_per_minute {
        return Err(anyhow!("{}_BURST must be <= {}_PER_MINUTE", prefix, prefix));
    }
    Ok(())
}

fn validate_usize_budget(
    name: &'static str,
    value: usize,
    min: usize,
    max: usize,
) -> anyhow::Result<()> {
    if value < min || value > max {
        return Err(anyhow!("{name} must be between {min} and {max}"));
    }
    Ok(())
}

fn validate_u64_budget(name: &'static str, value: u64, min: u64, max: u64) -> anyhow::Result<()> {
    if value < min || value > max {
        return Err(anyhow!("{name} must be between {min} and {max}"));
    }
    Ok(())
}

fn validate_u32_budget(name: &'static str, value: u32, min: u32, max: u32) -> anyhow::Result<()> {
    if value < min || value > max {
        return Err(anyhow!("{name} must be between {min} and {max}"));
    }
    Ok(())
}

fn validate_f32_budget(name: &'static str, value: f32, min: f32, max: f32) -> anyhow::Result<()> {
    if value < min || value > max {
        return Err(anyhow!("{name} must be between {min} and {max}"));
    }
    Ok(())
}
