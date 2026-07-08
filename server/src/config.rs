use std::time::Duration;

use crate::session::{SessionConfig, SessionIssueRateLimitConfig};

mod auth;
mod budget;
mod env;
mod network;
mod public_deployment;

pub(crate) use self::auth::{
    account_auth_config, validate_account_jwt, AccountAuthConfig, AccountAuthMode,
    MAX_AUTH_TOKEN_BYTES, MAX_JWT_AUDIENCE_BYTES, MAX_JWT_ISSUER_BYTES,
};
#[cfg(test)]
pub(crate) use self::auth::{validate_account_subject, MAX_ACCOUNT_SUBJECT_BYTES};
pub(crate) use self::budget::{validate_runtime_budget_config, RuntimeBudgetConfig};
pub(crate) use self::env::{
    admission_backend, bind_addr, deployment_profile, env_bool, env_optional_nonempty_string,
    env_positive_f32, env_positive_u32, env_positive_u64, env_positive_usize, persistence_backend,
    validate_bind_addr, validate_chain_mode, validate_deployment_profile,
    validate_supported_admission_backend, validate_supported_persistence_backend,
};
#[cfg(test)]
pub(crate) use self::env::{
    parse_admission_backend_value, parse_bool_value, parse_deployment_profile_value,
    parse_persistence_backend_value, parse_positive_f32_value, parse_positive_u32_value,
    parse_positive_u64_value, parse_positive_usize_value,
};
pub(crate) use self::network::{
    client_ingress_config, origin_allowlist_config, websocket_config, OriginAllowlistConfig,
    WebSocketConfig,
};
#[cfg(test)]
pub(crate) use self::network::{
    parse_origin_allowlist_value, validate_websocket_timing, MAX_ALLOWED_ORIGINS, MAX_ORIGIN_BYTES,
};
pub(crate) use self::public_deployment::validate_public_deployment;

const DEFAULT_SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS: usize = 4096;
const DEFAULT_ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE: u32 = 60;
const DEFAULT_ACCOUNT_SESSION_RATE_LIMIT_BURST: u32 = 10;
const DEFAULT_ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DeploymentProfile {
    Local,
    SharedPoc,
    Production,
}

impl DeploymentProfile {
    pub(crate) fn name(self) -> &'static str {
        match self {
            DeploymentProfile::Local => "local",
            DeploymentProfile::SharedPoc => "shared-poc",
            DeploymentProfile::Production => "production",
        }
    }

    fn requires_public_deployment(self) -> bool {
        matches!(
            self,
            DeploymentProfile::SharedPoc | DeploymentProfile::Production
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PersistenceBackend {
    Jsonl,
    Postgres,
}

impl PersistenceBackend {
    pub(crate) fn name(self) -> &'static str {
        match self {
            PersistenceBackend::Jsonl => "jsonl",
            PersistenceBackend::Postgres => "postgres",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AdmissionBackend {
    InMemory,
    Redis,
}

impl AdmissionBackend {
    pub(crate) fn name(self) -> &'static str {
        match self {
            AdmissionBackend::InMemory => "in-memory",
            AdmissionBackend::Redis => "redis",
        }
    }
}

pub(crate) fn session_config() -> anyhow::Result<SessionConfig> {
    let require_session = env_bool("REQUIRE_SESSION", false)?;
    let ticket_ttl = Duration::from_secs(env_positive_u64("SESSION_TICKET_TTL_SECONDS", 120)?);
    let ticket_capacity = env_positive_usize("SESSION_TICKET_CAPACITY", 2048)?;

    Ok(SessionConfig {
        require_session,
        ticket_ttl,
        ticket_capacity,
    })
}

pub(crate) fn session_issue_rate_limit_config() -> anyhow::Result<SessionIssueRateLimitConfig> {
    let requests_per_minute = env_positive_u32("SESSION_ISSUE_RATE_LIMIT_PER_MINUTE", 120)?;
    let burst = env_positive_u32("SESSION_ISSUE_RATE_LIMIT_BURST", 30)?;
    let max_clients = env_positive_usize(
        "SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS",
        DEFAULT_SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS,
    )?;

    Ok(SessionIssueRateLimitConfig {
        requests_per_minute,
        burst,
        max_clients,
    })
}

pub(crate) fn account_session_rate_limit_config() -> anyhow::Result<SessionIssueRateLimitConfig> {
    let requests_per_minute = env_positive_u32(
        "ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE",
        DEFAULT_ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE,
    )?;
    let burst = env_positive_u32(
        "ACCOUNT_SESSION_RATE_LIMIT_BURST",
        DEFAULT_ACCOUNT_SESSION_RATE_LIMIT_BURST,
    )?;
    let max_clients = env_positive_usize(
        "ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS",
        DEFAULT_ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS,
    )?;

    Ok(SessionIssueRateLimitConfig {
        requests_per_minute,
        burst,
        max_clients,
    })
}
