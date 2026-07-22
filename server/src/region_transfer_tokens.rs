use std::collections::HashMap;

use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::sim::PlayerTransferState;

const TRANSFER_TOKEN_SCHEMA: &str = "duskfell-region-transfer-ticket-v1";
const MIN_TRANSFER_SECRET_BYTES: usize = 32;
const MAX_TRANSFER_TTL_SECONDS: u64 = 300;
const MAX_TRANSFER_CLOCK_SKEW_SECONDS: u64 = 30;
pub(crate) const MAX_REGION_TRANSFER_TOKEN_BYTES: usize = 32 * 1024;

#[derive(Debug, Clone)]
pub(crate) struct RegionTransferTokenConfig {
    secret: Vec<u8>,
    ttl_seconds: u64,
    consumed_capacity: usize,
}

impl RegionTransferTokenConfig {
    pub(crate) fn new(
        secret: impl AsRef<[u8]>,
        ttl_seconds: u64,
        consumed_capacity: usize,
    ) -> Result<Self, RegionTransferTokenError> {
        let secret = secret.as_ref();
        if secret.len() < MIN_TRANSFER_SECRET_BYTES {
            return Err(RegionTransferTokenError::WeakSecret);
        }
        if ttl_seconds == 0 || ttl_seconds > MAX_TRANSFER_TTL_SECONDS {
            return Err(RegionTransferTokenError::InvalidTtl);
        }
        if consumed_capacity == 0 {
            return Err(RegionTransferTokenError::InvalidCapacity);
        }
        Ok(Self {
            secret: secret.to_vec(),
            ttl_seconds,
            consumed_capacity,
        })
    }
}

#[derive(Debug)]
pub(crate) struct RegionTransferTokens {
    config: RegionTransferTokenConfig,
    consumed: HashMap<Uuid, u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RegionTransferTokenError {
    WeakSecret,
    InvalidTtl,
    InvalidCapacity,
    ClockOverflow,
    EncodeFailed,
    InvalidToken,
    Expired,
    WrongAtlas,
    WrongDestination,
    Replay,
    CapacityReached,
}

impl std::fmt::Display for RegionTransferTokenError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::WeakSecret => "region transfer secret must be at least 32 bytes",
            Self::InvalidTtl => "region transfer TTL must be between 1 and 300 seconds",
            Self::InvalidCapacity => "region transfer consumed-token capacity must be positive",
            Self::ClockOverflow => "region transfer expiry overflowed",
            Self::EncodeFailed => "region transfer token could not be encoded",
            Self::InvalidToken => "region transfer token is invalid",
            Self::Expired => "region transfer token is expired",
            Self::WrongAtlas => "region transfer token is bound to another atlas",
            Self::WrongDestination => {
                "region transfer token is bound to another destination region"
            }
            Self::Replay => "region transfer token was already consumed",
            Self::CapacityReached => "region transfer replay ledger reached capacity",
        })
    }
}

impl std::error::Error for RegionTransferTokenError {}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RegionTransferClaims {
    schema: String,
    jti: Uuid,
    iss: String,
    aud: String,
    sub: Uuid,
    iat: u64,
    exp: u64,
    atlas_id: String,
    atlas_content_sha256: String,
    state: PlayerTransferState,
}

impl RegionTransferTokens {
    pub(crate) fn new(config: RegionTransferTokenConfig) -> Self {
        Self {
            config,
            consumed: HashMap::new(),
        }
    }

    pub(crate) fn issue(
        &self,
        state: PlayerTransferState,
        now_unix_seconds: u64,
    ) -> Result<String, RegionTransferTokenError> {
        let exp = now_unix_seconds
            .checked_add(self.config.ttl_seconds)
            .ok_or(RegionTransferTokenError::ClockOverflow)?;
        let claims = RegionTransferClaims {
            schema: TRANSFER_TOKEN_SCHEMA.to_string(),
            jti: Uuid::new_v4(),
            iss: state.from_region.clone(),
            aud: state.to_region.clone(),
            sub: state.player_id,
            iat: now_unix_seconds,
            exp,
            atlas_id: state.atlas_id.clone(),
            atlas_content_sha256: state.atlas_content_sha256.clone(),
            state,
        };
        encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(&self.config.secret),
        )
        .map_err(|_| RegionTransferTokenError::EncodeFailed)
    }

    pub(crate) fn consume(
        &mut self,
        token: &str,
        expected_atlas_id: &str,
        expected_atlas_content_sha256: &str,
        expected_region: &str,
        now_unix_seconds: u64,
    ) -> Result<PlayerTransferState, RegionTransferTokenError> {
        if token.is_empty() || token.len() > MAX_REGION_TRANSFER_TOKEN_BYTES {
            return Err(RegionTransferTokenError::InvalidToken);
        }
        self.consumed
            .retain(|_, expires_at| *expires_at > now_unix_seconds);

        let mut validation = Validation::new(Algorithm::HS256);
        validation.validate_exp = false;
        validation.validate_aud = false;
        validation.set_required_spec_claims(&["exp", "iat", "iss", "aud", "sub", "jti"]);
        let claims = decode::<RegionTransferClaims>(
            token,
            &DecodingKey::from_secret(&self.config.secret),
            &validation,
        )
        .map_err(|_| RegionTransferTokenError::InvalidToken)?
        .claims;

        if claims.schema != TRANSFER_TOKEN_SCHEMA
            || claims.sub != claims.state.player_id
            || claims.iss != claims.state.from_region
            || claims.aud != claims.state.to_region
            || claims.iat > now_unix_seconds.saturating_add(MAX_TRANSFER_CLOCK_SKEW_SECONDS)
            || claims.exp <= claims.iat
            || claims.exp.saturating_sub(claims.iat) > self.config.ttl_seconds
        {
            return Err(RegionTransferTokenError::InvalidToken);
        }
        if claims.exp <= now_unix_seconds {
            return Err(RegionTransferTokenError::Expired);
        }
        if claims.atlas_id != expected_atlas_id
            || claims.atlas_content_sha256 != expected_atlas_content_sha256
            || claims.atlas_id != claims.state.atlas_id
            || claims.atlas_content_sha256 != claims.state.atlas_content_sha256
        {
            return Err(RegionTransferTokenError::WrongAtlas);
        }
        if claims.aud != expected_region {
            return Err(RegionTransferTokenError::WrongDestination);
        }
        if self.consumed.contains_key(&claims.jti) {
            return Err(RegionTransferTokenError::Replay);
        }
        if self.consumed.len() >= self.config.consumed_capacity {
            return Err(RegionTransferTokenError::CapacityReached);
        }
        self.consumed.insert(claims.jti, claims.exp);
        Ok(claims.state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sim::PlayerTransferInventoryStack;

    #[test]
    fn token_is_signature_atlas_destination_expiry_and_replay_bound() {
        let config =
            RegionTransferTokenConfig::new("a-region-transfer-secret-long-enough-for-hs256", 20, 8)
                .expect("config is valid");
        let state = fixture_state();
        let token = RegionTransferTokens::new(config.clone())
            .issue(state.clone(), 1_000)
            .expect("token issues");
        let mut destination = RegionTransferTokens::new(config.clone());
        let admitted = destination
            .consume(&token, "duskfell", &"a".repeat(64), "duskfell-r1-0", 1_010)
            .expect("destination consumes token");
        assert_eq!(admitted, state);
        assert_eq!(
            destination.consume(&token, "duskfell", &"a".repeat(64), "duskfell-r1-0", 1_011),
            Err(RegionTransferTokenError::Replay)
        );

        let mut wrong_destination = RegionTransferTokens::new(config.clone());
        assert_eq!(
            wrong_destination.consume(&token, "duskfell", &"a".repeat(64), "duskfell-r9-9", 1_010,),
            Err(RegionTransferTokenError::WrongDestination)
        );
        let mut wrong_atlas = RegionTransferTokens::new(config.clone());
        assert_eq!(
            wrong_atlas.consume(
                &token,
                "other-atlas",
                &"a".repeat(64),
                "duskfell-r1-0",
                1_010,
            ),
            Err(RegionTransferTokenError::WrongAtlas)
        );
        let mut expired = RegionTransferTokens::new(config.clone());
        assert_eq!(
            expired.consume(&token, "duskfell", &"a".repeat(64), "duskfell-r1-0", 1_020),
            Err(RegionTransferTokenError::Expired)
        );

        let mut tampered = token.into_bytes();
        let last = tampered.len() - 1;
        tampered[last] = if tampered[last] == b'a' { b'b' } else { b'a' };
        let tampered = String::from_utf8(tampered).expect("JWT remains ASCII");
        let mut verifier = RegionTransferTokens::new(config);
        assert_eq!(
            verifier.consume(
                &tampered,
                "duskfell",
                &"a".repeat(64),
                "duskfell-r1-0",
                1_010,
            ),
            Err(RegionTransferTokenError::InvalidToken)
        );
    }

    #[test]
    fn config_rejects_weak_secrets_and_unbounded_ttl() {
        assert!(matches!(
            RegionTransferTokenConfig::new("short", 20, 8),
            Err(RegionTransferTokenError::WeakSecret)
        ));
        assert!(matches!(
            RegionTransferTokenConfig::new("a-region-transfer-secret-long-enough", 301, 8),
            Err(RegionTransferTokenError::InvalidTtl)
        ));
    }

    fn fixture_state() -> PlayerTransferState {
        PlayerTransferState {
            schema_version: "duskfell-player-transfer-v1".to_string(),
            atlas_id: "duskfell".to_string(),
            atlas_content_sha256: "a".repeat(64),
            from_region: "duskfell-r0-0".to_string(),
            to_region: "duskfell-r1-0".to_string(),
            player_id: Uuid::new_v4(),
            account_subject: Some("acct:traveler-7".to_string()),
            name: "Roadwarden".to_string(),
            demo_deeds: vec!["deed-ancient-crossing".to_string()],
            destination_x: 28.0,
            destination_y: 500.0,
            inventory_capacity_slots: 8,
            inventory_stacks: vec![PlayerTransferInventoryStack {
                item_id: "wood".to_string(),
                quantity: 17,
                age_years: 3,
                age_progress_years: 0.25,
            }],
        }
    }
}
