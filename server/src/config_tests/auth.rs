use crate::auth::{bounded_bearer_token, bounded_header_str, constant_time_eq};
use crate::config::{
    validate_account_jwt, validate_account_subject, MAX_ACCOUNT_SUBJECT_BYTES, MAX_AUTH_TOKEN_BYTES,
};
use axum::http::{header::AUTHORIZATION, HeaderMap, HeaderValue};
use jsonwebtoken::{encode, EncodingKey, Header};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn token_compare_requires_exact_bytes() {
    assert!(constant_time_eq("admin-token", "admin-token"));
    assert!(!constant_time_eq("admin-token", "admin-tokem"));
    assert!(!constant_time_eq("admin-token", "admin-token-extra"));
    assert!(!constant_time_eq("admin-token-extra", "admin-token"));
    assert!(!constant_time_eq("", "admin-token"));
}

#[test]
fn auth_headers_are_bounded_before_validation() {
    let mut headers = HeaderMap::new();
    headers.insert("x-admin-token", HeaderValue::from_static("short-token"));
    assert_eq!(
        bounded_header_str(&headers, "x-admin-token"),
        Some("short-token")
    );

    let max_token = "a".repeat(MAX_AUTH_TOKEN_BYTES);
    headers.insert(
        "x-admin-token",
        HeaderValue::from_str(&max_token).expect("max token is valid header value"),
    );
    assert_eq!(
        bounded_header_str(&headers, "x-admin-token"),
        Some(max_token.as_str())
    );

    let oversized_token = "a".repeat(MAX_AUTH_TOKEN_BYTES + 1);
    headers.insert(
        "x-admin-token",
        HeaderValue::from_str(&oversized_token).expect("oversized token is valid header value"),
    );
    assert_eq!(bounded_header_str(&headers, "x-admin-token"), None);

    let bearer = format!("Bearer {}", "b".repeat(MAX_AUTH_TOKEN_BYTES));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&bearer).expect("max bearer token is valid header value"),
    );
    assert_eq!(
        bounded_bearer_token(&headers),
        Some("b".repeat(MAX_AUTH_TOKEN_BYTES).as_str())
    );

    let oversized_bearer = format!("Bearer {}", "b".repeat(MAX_AUTH_TOKEN_BYTES + 1));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&oversized_bearer)
            .expect("oversized bearer token is valid header value"),
    );
    assert_eq!(bounded_bearer_token(&headers), None);
}

#[test]
fn account_jwt_validation_enforces_signature_subject_issuer_and_audience() {
    let secret = "account-jwt-unit-secret";
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock after epoch")
        .as_secs();
    let token = encode(
        &Header::default(),
        &json!({
            "sub": "acct:player-7",
            "iss": "https://identity.example",
            "aud": "sundermere",
            "exp": now + 60,
        }),
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .expect("jwt encodes");

    assert_eq!(
        validate_account_jwt(
            &token,
            secret,
            Some("https://identity.example"),
            Some("sundermere")
        )
        .expect("jwt validates"),
        "acct:player-7"
    );
    assert!(validate_account_jwt(
        &token,
        "wrong-secret",
        Some("https://identity.example"),
        Some("sundermere")
    )
    .is_err());
    assert!(validate_account_jwt(
        &token,
        secret,
        Some("https://other.example"),
        Some("sundermere")
    )
    .is_err());
    assert!(validate_account_jwt(
        &token,
        secret,
        Some("https://identity.example"),
        Some("other-game")
    )
    .is_err());

    let expired = encode(
        &Header::default(),
        &json!({
            "sub": "acct:player-7",
            "iss": "https://identity.example",
            "aud": "sundermere",
            "exp": now - 1,
        }),
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .expect("expired jwt encodes");
    assert!(validate_account_jwt(
        &expired,
        secret,
        Some("https://identity.example"),
        Some("sundermere")
    )
    .is_err());

    assert!(validate_account_subject("acct:wallet:0xabc123").is_ok());
    assert!(validate_account_subject(" acct:wallet:0xabc123").is_err());
    assert!(validate_account_subject(&"a".repeat(MAX_ACCOUNT_SUBJECT_BYTES + 1)).is_err());
    assert!(validate_account_subject("acct:\nplayer").is_err());
}
