use std::time::{SystemTime, UNIX_EPOCH};

use super::{env_bool, env_optional_nonempty_string};
use anyhow::anyhow;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::Deserialize;

pub(crate) const MAX_ACCOUNT_SUBJECT_BYTES: usize = 128;
pub(crate) const MAX_AUTH_TOKEN_BYTES: usize = 4096;
pub(crate) const MAX_JWT_ISSUER_BYTES: usize = 512;
pub(crate) const MAX_JWT_AUDIENCE_BYTES: usize = 256;

#[derive(Debug, Clone)]
pub(crate) struct AccountAuthConfig {
    pub(crate) require_account: bool,
    pub(crate) mode: AccountAuthMode,
}

#[derive(Debug, Clone)]
pub(crate) enum AccountAuthMode {
    Disabled,
    DevToken {
        token: String,
    },
    JwtHs256 {
        secret: String,
        issuer: Option<String>,
        audience: Option<String>,
    },
}

impl AccountAuthConfig {
    pub(crate) fn mode_name(&self) -> &'static str {
        match &self.mode {
            AccountAuthMode::Disabled => "disabled",
            AccountAuthMode::DevToken { .. } => "dev-token",
            AccountAuthMode::JwtHs256 { .. } => "jwt-hs256",
        }
    }

    pub(crate) fn dev_account_token_configured(&self) -> bool {
        matches!(self.mode, AccountAuthMode::DevToken { .. })
    }

    pub(crate) fn jwt_issuer_configured(&self) -> bool {
        matches!(
            self.mode,
            AccountAuthMode::JwtHs256 {
                issuer: Some(_),
                ..
            }
        )
    }

    pub(crate) fn jwt_audience_configured(&self) -> bool {
        matches!(
            self.mode,
            AccountAuthMode::JwtHs256 {
                audience: Some(_),
                ..
            }
        )
    }
}

#[derive(Debug, Deserialize)]
struct AccountJwtClaims {
    sub: String,
    exp: u64,
}

pub(crate) fn account_auth_config() -> anyhow::Result<AccountAuthConfig> {
    let require_account = env_bool("REQUIRE_ACCOUNT", false)?;
    let configured_mode = std::env::var("ACCOUNT_AUTH_MODE")
        .ok()
        .filter(|value| !value.trim().is_empty());

    let mode = if !require_account {
        AccountAuthMode::Disabled
    } else {
        match configured_mode.as_deref().unwrap_or("dev-token") {
            "dev-token" => {
                let token = env_optional_nonempty_string("DEV_ACCOUNT_TOKEN")?
                    .ok_or_else(|| anyhow!("REQUIRE_ACCOUNT=true requires DEV_ACCOUNT_TOKEN"))?;
                AccountAuthMode::DevToken { token }
            }
            "jwt-hs256" => {
                let secret = env_optional_nonempty_string("ACCOUNT_JWT_HS256_SECRET")?.ok_or_else(
                    || {
                        anyhow!(
                            "REQUIRE_ACCOUNT=true with ACCOUNT_AUTH_MODE=jwt-hs256 requires ACCOUNT_JWT_HS256_SECRET"
                        )
                    },
                )?;
                let issuer = env_optional_nonempty_string("ACCOUNT_JWT_ISSUER")?;
                let audience = env_optional_nonempty_string("ACCOUNT_JWT_AUDIENCE")?;
                AccountAuthMode::JwtHs256 {
                    secret,
                    issuer,
                    audience,
                }
            }
            other => {
                return Err(anyhow!(
                    "ACCOUNT_AUTH_MODE must be dev-token or jwt-hs256, got {other}"
                ));
            }
        }
    };

    Ok(AccountAuthConfig {
        require_account,
        mode,
    })
}

pub(crate) fn validate_account_jwt(
    token: &str,
    secret: &str,
    issuer: Option<&str>,
    audience: Option<&str>,
) -> anyhow::Result<String> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    validation.set_required_spec_claims(&["exp", "sub"]);
    if let Some(issuer) = issuer {
        validation.set_issuer(&[issuer]);
    }
    if let Some(audience) = audience {
        validation.set_audience(&[audience]);
    } else {
        validation.validate_aud = false;
    }

    let token = decode::<AccountJwtClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    validate_account_subject(&token.claims.sub)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| anyhow!("system clock before UNIX epoch: {err}"))?
        .as_secs();
    if token.claims.exp <= now {
        return Err(anyhow!("account JWT is expired"));
    }
    Ok(token.claims.sub)
}

pub(crate) fn validate_account_subject(subject: &str) -> anyhow::Result<()> {
    if subject.trim().is_empty() {
        return Err(anyhow!("account JWT subject is empty"));
    }
    if subject.trim() != subject {
        return Err(anyhow!(
            "account JWT subject must not have surrounding whitespace"
        ));
    }
    if subject.len() > MAX_ACCOUNT_SUBJECT_BYTES {
        return Err(anyhow!(
            "account JWT subject must be at most {MAX_ACCOUNT_SUBJECT_BYTES} bytes"
        ));
    }
    if !subject.is_ascii() || subject.chars().any(char::is_control) {
        return Err(anyhow!("account JWT subject must be printable ASCII"));
    }
    Ok(())
}
