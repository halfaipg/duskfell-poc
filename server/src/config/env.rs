use std::net::SocketAddr;

use super::{AdmissionBackend, DeploymentProfile, PersistenceBackend};
use anyhow::anyhow;

pub(crate) fn env_bool(name: &str, default: bool) -> anyhow::Result<bool> {
    match std::env::var(name) {
        Ok(value) => parse_bool_value(name, &value),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(err) => Err(anyhow!("{name} is not readable: {err}")),
    }
}

pub(crate) fn env_positive_u64(name: &str, default: u64) -> anyhow::Result<u64> {
    match std::env::var(name) {
        Ok(value) => parse_positive_u64_value(name, &value),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(err) => Err(anyhow!("{name} is not readable: {err}")),
    }
}

pub(crate) fn env_positive_usize(name: &str, default: usize) -> anyhow::Result<usize> {
    match std::env::var(name) {
        Ok(value) => parse_positive_usize_value(name, &value),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(err) => Err(anyhow!("{name} is not readable: {err}")),
    }
}

pub(crate) fn env_positive_u32(name: &str, default: u32) -> anyhow::Result<u32> {
    match std::env::var(name) {
        Ok(value) => parse_positive_u32_value(name, &value),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(err) => Err(anyhow!("{name} is not readable: {err}")),
    }
}

pub(crate) fn env_positive_f32(name: &str, default: f32) -> anyhow::Result<f32> {
    match std::env::var(name) {
        Ok(value) => parse_positive_f32_value(name, &value),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(err) => Err(anyhow!("{name} is not readable: {err}")),
    }
}

pub(crate) fn env_optional_nonempty_string(name: &str) -> anyhow::Result<Option<String>> {
    match std::env::var(name) {
        Ok(value) if value.trim().is_empty() => Ok(None),
        Ok(value) => Ok(Some(value)),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(err) => Err(anyhow!("{name} is not readable: {err}")),
    }
}

pub(crate) fn deployment_profile() -> anyhow::Result<DeploymentProfile> {
    match std::env::var("DEPLOYMENT_PROFILE") {
        Ok(value) => parse_deployment_profile_value(&value),
        Err(std::env::VarError::NotPresent) => Ok(DeploymentProfile::Local),
        Err(err) => Err(anyhow!("DEPLOYMENT_PROFILE is not readable: {err}")),
    }
}

pub(crate) fn parse_deployment_profile_value(value: &str) -> anyhow::Result<DeploymentProfile> {
    match value.trim() {
        "" | "local" => Ok(DeploymentProfile::Local),
        "shared-poc" => Ok(DeploymentProfile::SharedPoc),
        "production" => Ok(DeploymentProfile::Production),
        other => Err(anyhow!(
            "DEPLOYMENT_PROFILE must be local, shared-poc, or production, got {other}"
        )),
    }
}

pub(crate) fn persistence_backend() -> anyhow::Result<PersistenceBackend> {
    match std::env::var("PERSISTENCE_BACKEND") {
        Ok(value) => parse_persistence_backend_value(&value),
        Err(std::env::VarError::NotPresent) => Ok(PersistenceBackend::Jsonl),
        Err(err) => Err(anyhow!("PERSISTENCE_BACKEND is not readable: {err}")),
    }
}

pub(crate) fn parse_persistence_backend_value(value: &str) -> anyhow::Result<PersistenceBackend> {
    match value.trim() {
        "" | "jsonl" => Ok(PersistenceBackend::Jsonl),
        "postgres" => Ok(PersistenceBackend::Postgres),
        other => Err(anyhow!(
            "PERSISTENCE_BACKEND must be jsonl or postgres, got {other}"
        )),
    }
}

pub(crate) fn validate_supported_persistence_backend(
    persistence_backend: PersistenceBackend,
) -> anyhow::Result<()> {
    if persistence_backend == PersistenceBackend::Jsonl {
        return Ok(());
    }

    Err(anyhow!(
        "PERSISTENCE_BACKEND=postgres is reserved for the production database/event-store path, but this PoC runtime only implements PERSISTENCE_BACKEND=jsonl"
    ))
}

pub(crate) fn admission_backend() -> anyhow::Result<AdmissionBackend> {
    match std::env::var("ADMISSION_BACKEND") {
        Ok(value) => parse_admission_backend_value(&value),
        Err(std::env::VarError::NotPresent) => Ok(AdmissionBackend::InMemory),
        Err(err) => Err(anyhow!("ADMISSION_BACKEND is not readable: {err}")),
    }
}

pub(crate) fn parse_admission_backend_value(value: &str) -> anyhow::Result<AdmissionBackend> {
    match value.trim() {
        "" | "in-memory" => Ok(AdmissionBackend::InMemory),
        "redis" => Ok(AdmissionBackend::Redis),
        other => Err(anyhow!(
            "ADMISSION_BACKEND must be in-memory or redis, got {other}"
        )),
    }
}

pub(crate) fn validate_supported_admission_backend(
    admission_backend: AdmissionBackend,
) -> anyhow::Result<()> {
    if admission_backend == AdmissionBackend::InMemory {
        return Ok(());
    }

    Err(anyhow!(
        "ADMISSION_BACKEND=redis is reserved for shared session/admission/rate-limit state, but this PoC runtime only implements ADMISSION_BACKEND=in-memory"
    ))
}

pub(crate) fn bind_addr() -> anyhow::Result<SocketAddr> {
    std::env::var("BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:4107".to_string())
        .parse()
        .map_err(|err| anyhow!("BIND_ADDR must be a socket address: {err}"))
}

pub(crate) fn validate_bind_addr(public_deployment: bool, addr: SocketAddr) -> anyhow::Result<()> {
    if public_deployment || addr.ip().is_loopback() {
        return Ok(());
    }

    Err(anyhow!(
        "BIND_ADDR {} is not loopback; set PUBLIC_DEPLOYMENT=true and required public deployment guardrails before binding externally",
        addr
    ))
}

pub(crate) fn validate_chain_mode(
    public_deployment: bool,
    chain_enabled: bool,
) -> anyhow::Result<()> {
    if !public_deployment || !chain_enabled {
        return Ok(());
    }

    Err(anyhow!(
        "CHAIN_ENABLED=true is not supported with PUBLIC_DEPLOYMENT=true until SIGNER_SERVICE_URL/INDEXER_SERVICE_URL and signer/indexer implementations are available"
    ))
}

pub(crate) fn validate_deployment_profile(
    deployment_profile: DeploymentProfile,
    public_deployment: bool,
) -> anyhow::Result<()> {
    if public_deployment && deployment_profile == DeploymentProfile::Local {
        return Err(anyhow!(
            "PUBLIC_DEPLOYMENT=true requires DEPLOYMENT_PROFILE=shared-poc or production"
        ));
    }

    if deployment_profile.requires_public_deployment() && !public_deployment {
        return Err(anyhow!(
            "DEPLOYMENT_PROFILE={} requires PUBLIC_DEPLOYMENT=true",
            deployment_profile.name()
        ));
    }

    if deployment_profile != DeploymentProfile::Production {
        return Ok(());
    }

    Err(anyhow!(
        "DEPLOYMENT_PROFILE=production is not supported until durable database/event-store, isolated SIGNER_SERVICE_URL/INDEXER_SERVICE_URL signer/indexer services, and cross-process admission/rate-limit state are implemented"
    ))
}

pub(crate) fn parse_bool_value(name: &str, value: &str) -> anyhow::Result<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => Err(anyhow!(
            "{name} must be a boolean value: true/false, 1/0, yes/no, or on/off"
        )),
    }
}

pub(crate) fn parse_positive_u64_value(name: &str, value: &str) -> anyhow::Result<u64> {
    let parsed = value
        .trim()
        .parse::<u64>()
        .map_err(|_| anyhow!("{name} must be a positive integer"))?;
    if parsed == 0 {
        return Err(anyhow!("{name} must be greater than zero"));
    }
    Ok(parsed)
}

pub(crate) fn parse_positive_usize_value(name: &str, value: &str) -> anyhow::Result<usize> {
    let parsed = value
        .trim()
        .parse::<usize>()
        .map_err(|_| anyhow!("{name} must be a positive integer"))?;
    if parsed == 0 {
        return Err(anyhow!("{name} must be greater than zero"));
    }
    Ok(parsed)
}

pub(crate) fn parse_positive_u32_value(name: &str, value: &str) -> anyhow::Result<u32> {
    let parsed = value
        .trim()
        .parse::<u32>()
        .map_err(|_| anyhow!("{name} must be a positive integer"))?;
    if parsed == 0 {
        return Err(anyhow!("{name} must be greater than zero"));
    }
    Ok(parsed)
}

pub(crate) fn parse_positive_f32_value(name: &str, value: &str) -> anyhow::Result<f32> {
    let parsed = value
        .trim()
        .parse::<f32>()
        .map_err(|_| anyhow!("{name} must be a positive number"))?;
    if !parsed.is_finite() || parsed <= 0.0 {
        return Err(anyhow!("{name} must be a finite number greater than zero"));
    }
    Ok(parsed)
}
