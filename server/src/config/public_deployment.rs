use crate::session::SessionConfig;
use anyhow::anyhow;

use super::{
    AccountAuthConfig, AccountAuthMode, AdmissionBackend, OriginAllowlistConfig,
    PersistenceBackend, MAX_AUTH_TOKEN_BYTES, MAX_JWT_AUDIENCE_BYTES, MAX_JWT_ISSUER_BYTES,
};

const MIN_PUBLIC_DEPLOYMENT_TOKEN_BYTES: usize = 24;

pub(crate) fn validate_public_deployment(
    public_deployment: bool,
    session_config: &SessionConfig,
    account_auth: &AccountAuthConfig,
    origin_allowlist: &OriginAllowlistConfig,
    admin_token: Option<&str>,
    metrics_token: Option<&str>,
    durable_sync_writes: bool,
    persistence_backend_configured: bool,
    persistence_backend: PersistenceBackend,
    admission_backend_configured: bool,
    admission_backend: AdmissionBackend,
) -> anyhow::Result<()> {
    if !public_deployment {
        return Ok(());
    }

    let mut missing = Vec::new();
    if !session_config.require_session {
        missing.push("REQUIRE_SESSION=true");
    }
    if !account_auth.require_account {
        missing.push("REQUIRE_ACCOUNT=true");
    }
    match &account_auth.mode {
        AccountAuthMode::Disabled => {
            missing.push("ACCOUNT_AUTH_MODE=dev-token or jwt-hs256");
        }
        AccountAuthMode::DevToken { token } => {
            validate_public_deployment_token("DEV_ACCOUNT_TOKEN", token, &mut missing);
        }
        AccountAuthMode::JwtHs256 {
            secret,
            issuer,
            audience,
        } => {
            validate_public_deployment_token("ACCOUNT_JWT_HS256_SECRET", secret, &mut missing);
            validate_public_jwt_issuer(issuer.as_deref(), &mut missing);
            validate_public_jwt_audience(audience.as_deref(), &mut missing);
        }
    }
    if !origin_allowlist.enabled() {
        missing.push("ALLOWED_ORIGINS");
    }
    if !durable_sync_writes {
        missing.push("DURABLE_SYNC_WRITES=true");
    }
    if !persistence_backend_configured || persistence_backend != PersistenceBackend::Jsonl {
        missing.push("PERSISTENCE_BACKEND=jsonl");
    }
    if !admission_backend_configured || admission_backend != AdmissionBackend::InMemory {
        missing.push("ADMISSION_BACKEND=in-memory");
    }
    if admin_token.is_none() {
        missing.push("ADMIN_TOKEN");
    } else if let Some(token) = admin_token {
        validate_public_deployment_token("ADMIN_TOKEN", token, &mut missing);
    }
    if metrics_token.is_none() {
        missing.push("METRICS_TOKEN");
    } else if let Some(token) = metrics_token {
        validate_public_deployment_token("METRICS_TOKEN", token, &mut missing);
    }
    if let (Some(admin_token), Some(metrics_token)) = (admin_token, metrics_token) {
        if admin_token == metrics_token {
            missing.push("ADMIN_TOKEN and METRICS_TOKEN must be distinct");
        }
    }
    if let Some(account_secret) = account_auth_secret_for_distinct_check(account_auth) {
        if let Some(admin_token) = admin_token {
            if account_secret == admin_token {
                missing.push("account auth credential and ADMIN_TOKEN must be distinct");
            }
        }
        if let Some(metrics_token) = metrics_token {
            if account_secret == metrics_token {
                missing.push("account auth credential and METRICS_TOKEN must be distinct");
            }
        }
    }

    if missing.is_empty() {
        Ok(())
    } else {
        Err(anyhow!(
            "PUBLIC_DEPLOYMENT=true requires {}",
            missing.join(", ")
        ))
    }
}

fn validate_public_deployment_token(
    name: &'static str,
    token: &str,
    missing: &mut Vec<&'static str>,
) {
    if token.trim() != token {
        missing.push(match name {
            "ADMIN_TOKEN" => "ADMIN_TOKEN without surrounding whitespace",
            "METRICS_TOKEN" => "METRICS_TOKEN without surrounding whitespace",
            "DEV_ACCOUNT_TOKEN" => "DEV_ACCOUNT_TOKEN without surrounding whitespace",
            "ACCOUNT_JWT_HS256_SECRET" => "ACCOUNT_JWT_HS256_SECRET without surrounding whitespace",
            _ => "token without surrounding whitespace",
        });
    }
    if token.len() < MIN_PUBLIC_DEPLOYMENT_TOKEN_BYTES {
        missing.push(match name {
            "ADMIN_TOKEN" => "ADMIN_TOKEN length >= 24 bytes",
            "METRICS_TOKEN" => "METRICS_TOKEN length >= 24 bytes",
            "DEV_ACCOUNT_TOKEN" => "DEV_ACCOUNT_TOKEN length >= 24 bytes",
            "ACCOUNT_JWT_HS256_SECRET" => "ACCOUNT_JWT_HS256_SECRET length >= 24 bytes",
            _ => "token length >= 24 bytes",
        });
    }
    if token.len() > MAX_AUTH_TOKEN_BYTES {
        missing.push(match name {
            "ADMIN_TOKEN" => "ADMIN_TOKEN length <= 4096 bytes",
            "METRICS_TOKEN" => "METRICS_TOKEN length <= 4096 bytes",
            "DEV_ACCOUNT_TOKEN" => "DEV_ACCOUNT_TOKEN length <= 4096 bytes",
            "ACCOUNT_JWT_HS256_SECRET" => "ACCOUNT_JWT_HS256_SECRET length <= 4096 bytes",
            _ => "token length <= 4096 bytes",
        });
    }
    if looks_like_placeholder_secret(token) {
        missing.push(match name {
            "ADMIN_TOKEN" => "ADMIN_TOKEN must not use placeholder text",
            "METRICS_TOKEN" => "METRICS_TOKEN must not use placeholder text",
            "DEV_ACCOUNT_TOKEN" => "DEV_ACCOUNT_TOKEN must not use placeholder text",
            "ACCOUNT_JWT_HS256_SECRET" => "ACCOUNT_JWT_HS256_SECRET must not use placeholder text",
            _ => "token must not use placeholder text",
        });
    }
}

fn validate_public_jwt_issuer(issuer: Option<&str>, missing: &mut Vec<&'static str>) {
    let Some(issuer) = issuer else {
        missing.push("ACCOUNT_JWT_ISSUER");
        return;
    };

    if issuer.trim() != issuer {
        missing.push("ACCOUNT_JWT_ISSUER without surrounding whitespace");
    }
    if issuer.len() > MAX_JWT_ISSUER_BYTES {
        missing.push("ACCOUNT_JWT_ISSUER length <= 512 bytes");
    }
    if issuer
        .chars()
        .any(|character| character.is_ascii_whitespace() || character.is_control())
    {
        missing.push("ACCOUNT_JWT_ISSUER must not contain whitespace or control characters");
    }
    if issuer
        .chars()
        .any(|character| matches!(character, '?' | '#'))
    {
        missing.push("ACCOUNT_JWT_ISSUER must not include query or fragment");
    }

    match public_jwt_issuer_host(issuer) {
        Some(host) if is_local_jwt_issuer_host(host) => {
            missing.push("ACCOUNT_JWT_ISSUER must not use localhost or loopback");
        }
        Some(_) => {}
        None => {
            missing.push("ACCOUNT_JWT_ISSUER must be an https issuer URL with a host");
        }
    }
}

fn validate_public_jwt_audience(audience: Option<&str>, missing: &mut Vec<&'static str>) {
    let Some(audience) = audience else {
        missing.push("ACCOUNT_JWT_AUDIENCE");
        return;
    };

    if audience.trim() != audience {
        missing.push("ACCOUNT_JWT_AUDIENCE without surrounding whitespace");
    }
    if audience.len() > MAX_JWT_AUDIENCE_BYTES {
        missing.push("ACCOUNT_JWT_AUDIENCE length <= 256 bytes");
    }
    if audience
        .chars()
        .any(|character| character.is_ascii_whitespace() || character.is_control())
    {
        missing.push("ACCOUNT_JWT_AUDIENCE must not contain whitespace or control characters");
    }
    if looks_like_placeholder_secret(audience) {
        missing.push("ACCOUNT_JWT_AUDIENCE must not use placeholder text");
    }
}

fn public_jwt_issuer_host(issuer: &str) -> Option<&str> {
    let rest = issuer.strip_prefix("https://")?;
    if rest.is_empty()
        || rest
            .chars()
            .any(|character| matches!(character, '?' | '#' | '@'))
    {
        return None;
    }

    let authority = rest.split('/').next().unwrap_or_default();
    if authority.is_empty() {
        return None;
    }

    if let Some(without_open_bracket) = authority.strip_prefix('[') {
        let close_bracket = without_open_bracket.find(']')?;
        let host = &without_open_bracket[..close_bracket];
        let remainder = &without_open_bracket[close_bracket + 1..];
        if !valid_optional_port(remainder) {
            return None;
        }
        return (!host.is_empty()).then_some(host);
    }

    if let Some((host, port)) = authority.split_once(':') {
        if host.is_empty()
            || port.is_empty()
            || !port.chars().all(|character| character.is_ascii_digit())
            || port.contains(':')
        {
            return None;
        }
        return Some(host);
    }

    (!authority.is_empty()).then_some(authority)
}

fn valid_optional_port(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    let Some(port) = value.strip_prefix(':') else {
        return false;
    };
    !port.is_empty() && port.chars().all(|character| character.is_ascii_digit())
}

fn is_local_jwt_issuer_host(host: &str) -> bool {
    let normalized = host
        .trim_matches(|character| matches!(character, '[' | ']'))
        .to_ascii_lowercase();
    normalized == "localhost"
        || normalized == "::1"
        || normalized == "0.0.0.0"
        || normalized == "127.0.0.1"
        || normalized.starts_with("127.")
}

fn looks_like_placeholder_secret(token: &str) -> bool {
    let normalized = token.to_ascii_lowercase();
    [
        "replace-with",
        "placeholder",
        "changeme",
        "change-me",
        "todo",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

fn account_auth_secret_for_distinct_check(account_auth: &AccountAuthConfig) -> Option<&str> {
    match &account_auth.mode {
        AccountAuthMode::Disabled => None,
        AccountAuthMode::DevToken { token } => Some(token.as_str()),
        AccountAuthMode::JwtHs256 { secret, .. } => Some(secret.as_str()),
    }
}
