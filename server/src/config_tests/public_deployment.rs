use crate::config::{
    parse_origin_allowlist_value, validate_public_deployment, AccountAuthConfig, AccountAuthMode,
    AdmissionBackend, OriginAllowlistConfig, PersistenceBackend, MAX_AUTH_TOKEN_BYTES,
    MAX_JWT_AUDIENCE_BYTES, MAX_JWT_ISSUER_BYTES,
};
use crate::session::SessionConfig;
use std::time::Duration;

#[test]
fn public_deployment_requires_hardened_ingress_config() {
    let dev_sessions = SessionConfig {
        require_session: false,
        ticket_ttl: Duration::from_secs(120),
        ticket_capacity: 2048,
    };
    let strict_sessions = SessionConfig {
        require_session: true,
        ticket_ttl: Duration::from_secs(120),
        ticket_capacity: 2048,
    };
    let dev_account = AccountAuthConfig {
        require_account: false,
        mode: AccountAuthMode::Disabled,
    };
    let strict_account = AccountAuthConfig {
        require_account: true,
        mode: AccountAuthMode::DevToken {
            token: "account-token-public-1234".to_string(),
        },
    };
    let strict_jwt_account = AccountAuthConfig {
        require_account: true,
        mode: AccountAuthMode::JwtHs256 {
            secret: "account-jwt-public-secret".to_string(),
            issuer: Some("https://identity.example".to_string()),
            audience: Some("sundermere".to_string()),
        },
    };
    let origins = parse_origin_allowlist_value("https://play.example").expect("origin parses");

    assert!(validate_public_deployment(
        false,
        &dev_sessions,
        &dev_account,
        &OriginAllowlistConfig::disabled(),
        None,
        None,
        false,
        false,
        PersistenceBackend::Jsonl,
        false,
        AdmissionBackend::InMemory,
    )
    .is_ok());

    let err = validate_public_deployment(
        true,
        &dev_sessions,
        &dev_account,
        &OriginAllowlistConfig::disabled(),
        None,
        None,
        false,
        false,
        PersistenceBackend::Jsonl,
        false,
        AdmissionBackend::InMemory,
    )
    .expect_err("public deployment rejects local defaults");
    let message = err.to_string();
    assert!(message.contains("PUBLIC_DEPLOYMENT"));
    assert!(message.contains("REQUIRE_SESSION=true"));
    assert!(message.contains("REQUIRE_ACCOUNT=true"));
    assert!(message.contains("ACCOUNT_AUTH_MODE"));
    assert!(message.contains("ALLOWED_ORIGINS"));
    assert!(message.contains("DURABLE_SYNC_WRITES=true"));
    assert!(message.contains("PERSISTENCE_BACKEND=jsonl"));
    assert!(message.contains("ADMISSION_BACKEND=in-memory"));
    assert!(message.contains("ADMIN_TOKEN"));
    assert!(message.contains("METRICS_TOKEN"));

    assert!(validate_public_deployment(
        true,
        &strict_sessions,
        &strict_account,
        &origins,
        Some("admin-token-public-12345"),
        Some("metrics-token-public-123"),
        true,
        true,
        PersistenceBackend::Jsonl,
        true,
        AdmissionBackend::InMemory,
    )
    .is_ok());

    assert!(validate_public_deployment(
        true,
        &strict_sessions,
        &strict_jwt_account,
        &origins,
        Some("admin-token-public-12345"),
        Some("metrics-token-public-123"),
        true,
        true,
        PersistenceBackend::Jsonl,
        true,
        AdmissionBackend::InMemory,
    )
    .is_ok());

    let unsynced_durable_err = validate_public_deployment(
        true,
        &strict_sessions,
        &strict_account,
        &origins,
        Some("admin-token-public-12345"),
        Some("metrics-token-public-123"),
        false,
        true,
        PersistenceBackend::Jsonl,
        true,
        AdmissionBackend::InMemory,
    )
    .expect_err("public deployment requires synced durable writes");
    assert!(unsynced_durable_err
        .to_string()
        .contains("DURABLE_SYNC_WRITES=true"));

    let weak_err = validate_public_deployment(
        true,
        &strict_sessions,
        &AccountAuthConfig {
            require_account: true,
            mode: AccountAuthMode::DevToken {
                token: " weak-account-token ".to_string(),
            },
        },
        &origins,
        Some("short-admin-token"),
        Some(" short-metrics-token "),
        true,
        true,
        PersistenceBackend::Jsonl,
        true,
        AdmissionBackend::InMemory,
    )
    .expect_err("public deployment rejects weak tokens");
    let weak_message = weak_err.to_string();
    assert!(weak_message.contains("DEV_ACCOUNT_TOKEN length"));
    assert!(weak_message.contains("DEV_ACCOUNT_TOKEN without surrounding whitespace"));
    assert!(weak_message.contains("ADMIN_TOKEN length"));
    assert!(weak_message.contains("METRICS_TOKEN length"));
    assert!(weak_message.contains("METRICS_TOKEN without surrounding whitespace"));

    let oversized_err = validate_public_deployment(
        true,
        &strict_sessions,
        &AccountAuthConfig {
            require_account: true,
            mode: AccountAuthMode::DevToken {
                token: "a".repeat(MAX_AUTH_TOKEN_BYTES + 1),
            },
        },
        &origins,
        Some(&"b".repeat(MAX_AUTH_TOKEN_BYTES + 1)),
        Some(&"c".repeat(MAX_AUTH_TOKEN_BYTES + 1)),
        true,
        true,
        PersistenceBackend::Jsonl,
        true,
        AdmissionBackend::InMemory,
    )
    .expect_err("public deployment rejects oversized configured tokens");
    let oversized_message = oversized_err.to_string();
    assert!(oversized_message.contains("DEV_ACCOUNT_TOKEN length <= 4096 bytes"));
    assert!(oversized_message.contains("ADMIN_TOKEN length <= 4096 bytes"));
    assert!(oversized_message.contains("METRICS_TOKEN length <= 4096 bytes"));

    let placeholder_err = validate_public_deployment(
        true,
        &strict_sessions,
        &AccountAuthConfig {
            require_account: true,
            mode: AccountAuthMode::DevToken {
                token: "replace-with-strong-account-token".to_string(),
            },
        },
        &origins,
        Some("replace-with-strong-admin-token"),
        Some("metrics-token-placeholder-123"),
        true,
        true,
        PersistenceBackend::Jsonl,
        true,
        AdmissionBackend::InMemory,
    )
    .expect_err("public deployment rejects placeholder tokens");
    let placeholder_message = placeholder_err.to_string();
    assert!(placeholder_message.contains("DEV_ACCOUNT_TOKEN must not use placeholder text"));
    assert!(placeholder_message.contains("ADMIN_TOKEN must not use placeholder text"));
    assert!(placeholder_message.contains("METRICS_TOKEN must not use placeholder text"));

    let reused_err = validate_public_deployment(
        true,
        &strict_sessions,
        &AccountAuthConfig {
            require_account: true,
            mode: AccountAuthMode::DevToken {
                token: "shared-public-token-1234".to_string(),
            },
        },
        &origins,
        Some("shared-public-token-1234"),
        Some("metrics-token-public-123"),
        true,
        true,
        PersistenceBackend::Jsonl,
        true,
        AdmissionBackend::InMemory,
    )
    .expect_err("public deployment rejects reused token");
    assert!(reused_err.to_string().contains("must be distinct"));

    let jwt_missing_claims_err = validate_public_deployment(
        true,
        &strict_sessions,
        &AccountAuthConfig {
            require_account: true,
            mode: AccountAuthMode::JwtHs256 {
                secret: "account-jwt-public-secret".to_string(),
                issuer: None,
                audience: None,
            },
        },
        &origins,
        Some("admin-token-public-12345"),
        Some("metrics-token-public-123"),
        true,
        true,
        PersistenceBackend::Jsonl,
        true,
        AdmissionBackend::InMemory,
    )
    .expect_err("public deployment requires jwt issuer and audience");
    let jwt_message = jwt_missing_claims_err.to_string();
    assert!(jwt_message.contains("ACCOUNT_JWT_ISSUER"));
    assert!(jwt_message.contains("ACCOUNT_JWT_AUDIENCE"));

    let jwt_bad_identity_config_err = validate_public_deployment(
        true,
        &strict_sessions,
        &AccountAuthConfig {
            require_account: true,
            mode: AccountAuthMode::JwtHs256 {
                secret: "account-jwt-public-secret".to_string(),
                issuer: Some("https://127.0.0.1/issuer".to_string()),
                audience: Some(" replace-with-audience ".to_string()),
            },
        },
        &origins,
        Some("admin-token-public-12345"),
        Some("metrics-token-public-123"),
        true,
        true,
        PersistenceBackend::Jsonl,
        true,
        AdmissionBackend::InMemory,
    )
    .expect_err("public deployment rejects weak jwt identity config");
    let jwt_bad_identity_message = jwt_bad_identity_config_err.to_string();
    assert!(jwt_bad_identity_message.contains("ACCOUNT_JWT_ISSUER must not use localhost"));
    assert!(
        jwt_bad_identity_message.contains("ACCOUNT_JWT_AUDIENCE without surrounding whitespace")
    );
    assert!(jwt_bad_identity_message.contains("ACCOUNT_JWT_AUDIENCE must not contain whitespace"));
    assert!(jwt_bad_identity_message.contains("ACCOUNT_JWT_AUDIENCE must not use placeholder text"));

    let jwt_query_issuer_err = validate_public_deployment(
        true,
        &strict_sessions,
        &AccountAuthConfig {
            require_account: true,
            mode: AccountAuthMode::JwtHs256 {
                secret: "account-jwt-public-secret".to_string(),
                issuer: Some("https://identity.example/issuer?debug=true".to_string()),
                audience: Some("sundermere".to_string()),
            },
        },
        &origins,
        Some("admin-token-public-12345"),
        Some("metrics-token-public-123"),
        true,
        true,
        PersistenceBackend::Jsonl,
        true,
        AdmissionBackend::InMemory,
    )
    .expect_err("public deployment rejects jwt issuer query");
    assert!(jwt_query_issuer_err
        .to_string()
        .contains("ACCOUNT_JWT_ISSUER must not include query"));

    let jwt_oversized_identity_config_err = validate_public_deployment(
        true,
        &strict_sessions,
        &AccountAuthConfig {
            require_account: true,
            mode: AccountAuthMode::JwtHs256 {
                secret: "account-jwt-public-secret".to_string(),
                issuer: Some(format!("https://{}", "a".repeat(MAX_JWT_ISSUER_BYTES))),
                audience: Some("a".repeat(MAX_JWT_AUDIENCE_BYTES + 1)),
            },
        },
        &origins,
        Some("admin-token-public-12345"),
        Some("metrics-token-public-123"),
        true,
        true,
        PersistenceBackend::Jsonl,
        true,
        AdmissionBackend::InMemory,
    )
    .expect_err("public deployment rejects oversized jwt identity config");
    let jwt_oversized_identity_message = jwt_oversized_identity_config_err.to_string();
    assert!(jwt_oversized_identity_message.contains("ACCOUNT_JWT_ISSUER length <= 512 bytes"));
    assert!(jwt_oversized_identity_message.contains("ACCOUNT_JWT_AUDIENCE length <= 256 bytes"));
}
