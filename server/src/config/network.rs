use std::time::Duration;

use crate::ingress::{
    ClientIngressConfig, DEFAULT_MAX_CLIENT_TEXT_BYTES, DEFAULT_MAX_INPUT_SEQUENCE_STEP,
    DEFAULT_MESSAGE_BURST, DEFAULT_MESSAGE_REFILL_PER_SECOND,
};
use crate::sim::INTEREST_RADIUS;
use anyhow::anyhow;

use super::{env_positive_f32, env_positive_u32, env_positive_u64, env_positive_usize};

pub(crate) const MAX_ALLOWED_ORIGINS: usize = 16;
pub(crate) const MAX_ORIGIN_BYTES: usize = 512;

#[derive(Debug, Clone)]
pub(crate) struct WebSocketConfig {
    pub(crate) snapshot_interval: Duration,
    pub(crate) interest_radius: f32,
    pub(crate) heartbeat_interval: Duration,
    pub(crate) idle_timeout: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OriginAllowlistConfig {
    allowed: Vec<String>,
}

impl OriginAllowlistConfig {
    pub(crate) fn disabled() -> Self {
        Self {
            allowed: Vec::new(),
        }
    }

    pub(crate) fn enabled(&self) -> bool {
        !self.allowed.is_empty()
    }

    pub(crate) fn allowed_count(&self) -> usize {
        self.allowed.len()
    }

    pub(crate) fn allows(&self, origin: &str) -> bool {
        self.allowed.iter().any(|allowed| allowed == origin)
    }
}

pub(crate) fn origin_allowlist_config() -> anyhow::Result<OriginAllowlistConfig> {
    match std::env::var("ALLOWED_ORIGINS") {
        Ok(value) => parse_origin_allowlist_value(&value),
        Err(std::env::VarError::NotPresent) => Ok(OriginAllowlistConfig::disabled()),
        Err(err) => Err(anyhow!("ALLOWED_ORIGINS is not readable: {err}")),
    }
}

pub(crate) fn parse_origin_allowlist_value(value: &str) -> anyhow::Result<OriginAllowlistConfig> {
    if value.trim().is_empty() {
        return Ok(OriginAllowlistConfig::disabled());
    }

    let origins: Vec<&str> = value
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .collect();

    if origins.is_empty() {
        return Err(anyhow!("ALLOWED_ORIGINS must include at least one origin"));
    }
    if origins.len() > MAX_ALLOWED_ORIGINS {
        return Err(anyhow!(
            "ALLOWED_ORIGINS must include at most {MAX_ALLOWED_ORIGINS} origins"
        ));
    }

    let mut allowed = Vec::new();
    for origin in origins {
        validate_allowed_origin(origin)?;
        if !allowed
            .iter()
            .any(|allowed_origin| allowed_origin == origin)
        {
            allowed.push(origin.to_string());
        }
    }

    Ok(OriginAllowlistConfig { allowed })
}

fn validate_allowed_origin(origin: &str) -> anyhow::Result<()> {
    if origin.len() > MAX_ORIGIN_BYTES {
        return Err(anyhow!(
            "ALLOWED_ORIGINS entries must be at most {MAX_ORIGIN_BYTES} bytes"
        ));
    }
    if origin
        .chars()
        .any(|character| character.is_ascii_whitespace() || character.is_control())
    {
        return Err(anyhow!(
            "ALLOWED_ORIGINS entries must not contain whitespace or control characters"
        ));
    }

    let host = if let Some(host) = origin.strip_prefix("http://") {
        host
    } else if let Some(host) = origin.strip_prefix("https://") {
        host
    } else {
        return Err(anyhow!(
            "ALLOWED_ORIGINS entries must be exact http:// or https:// origins"
        ));
    };

    if host.is_empty()
        || host
            .chars()
            .any(|character| matches!(character, '/' | '?' | '#'))
    {
        return Err(anyhow!(
            "ALLOWED_ORIGINS entries must be exact http:// or https:// origins without path, query, or fragment"
        ));
    }

    Ok(())
}

pub(crate) fn websocket_config() -> anyhow::Result<WebSocketConfig> {
    let snapshot_interval_ms = env_positive_u64("SNAPSHOT_INTERVAL_MS", 50)?;
    let interest_radius = env_positive_f32("INTEREST_RADIUS", INTEREST_RADIUS)?;
    let heartbeat_seconds = env_positive_u64("WS_HEARTBEAT_SECONDS", 30)?;
    let idle_timeout_seconds = env_positive_u64("WS_IDLE_TIMEOUT_SECONDS", 180)?;
    validate_websocket_timing(heartbeat_seconds, idle_timeout_seconds)?;

    Ok(WebSocketConfig {
        snapshot_interval: Duration::from_millis(snapshot_interval_ms),
        interest_radius,
        heartbeat_interval: Duration::from_secs(heartbeat_seconds),
        idle_timeout: Duration::from_secs(idle_timeout_seconds),
    })
}

pub(crate) fn client_ingress_config() -> anyhow::Result<ClientIngressConfig> {
    Ok(ClientIngressConfig {
        max_text_bytes: env_positive_usize("WS_MAX_TEXT_BYTES", DEFAULT_MAX_CLIENT_TEXT_BYTES)?,
        message_burst: env_positive_u32("WS_MESSAGE_BURST", DEFAULT_MESSAGE_BURST)?,
        message_refill_per_second: env_positive_u32(
            "WS_MESSAGE_REFILL_PER_SECOND",
            DEFAULT_MESSAGE_REFILL_PER_SECOND,
        )?,
        max_input_sequence_step: env_positive_u64(
            "WS_MAX_INPUT_SEQUENCE_STEP",
            DEFAULT_MAX_INPUT_SEQUENCE_STEP,
        )?,
    })
}

pub(crate) fn validate_websocket_timing(
    heartbeat_seconds: u64,
    idle_timeout_seconds: u64,
) -> anyhow::Result<()> {
    if idle_timeout_seconds <= heartbeat_seconds {
        return Err(anyhow!(
            "WS_IDLE_TIMEOUT_SECONDS must be greater than WS_HEARTBEAT_SECONDS"
        ));
    }
    Ok(())
}
