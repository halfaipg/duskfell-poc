use crate::config::{
    validate_bind_addr, validate_chain_mode, validate_deployment_profile,
    validate_runtime_budget_config, DeploymentProfile, RuntimeBudgetConfig, WebSocketConfig,
};
use crate::http_routes::{has_hidden_path_segment, is_safe_request_id, sanitized_trace_path};
use crate::ingress::{ClientIngressConfig, DEFAULT_MAX_INPUT_SEQUENCE_STEP};
use crate::session::{SessionConfig, SessionIssueRateLimitConfig};
use crate::session_routes::{session_body_content_type, session_display_name_from_body};
use axum::http::{header::CONTENT_TYPE, HeaderMap, HeaderValue, StatusCode};
use std::time::Duration;

mod auth;
mod env;
mod network;
mod public_deployment;
mod readiness;

#[test]
fn request_ids_are_bounded_visible_tokens() {
    assert!(is_safe_request_id("trace-abc_123.4:edge"));
    assert!(is_safe_request_id(&"a".repeat(64)));
    assert!(!is_safe_request_id(""));
    assert!(!is_safe_request_id(&"a".repeat(65)));
    assert!(!is_safe_request_id("trace with spaces"));
    assert!(!is_safe_request_id("trace/header"));
    assert!(!is_safe_request_id("trace\nheader"));
}

#[test]
fn trace_path_redacts_query_strings() {
    let uri = "/ws?session=session-token-that-must-not-log"
        .parse()
        .expect("uri parses");
    assert_eq!(sanitized_trace_path(&uri), "/ws");

    let root = "/?token=secret".parse().expect("root uri parses");
    assert_eq!(sanitized_trace_path(&root), "/");
}

#[test]
fn hidden_path_segments_are_rejected_before_static_serving() {
    assert!(!has_hidden_path_segment("/"));
    assert!(!has_hidden_path_segment(
        "/assets/sprites/player-placeholder.png"
    ));
    assert!(!has_hidden_path_segment("/tiles/stone.floor.png"));
    assert!(has_hidden_path_segment("/.env"));
    assert!(has_hidden_path_segment("/assets/.secret"));
    assert!(has_hidden_path_segment("/assets/%2esecret"));
    assert!(has_hidden_path_segment("/assets/%2Egit/config"));
}

#[test]
fn validates_runtime_budget_invariants() {
    let config = valid_runtime_budget_config();
    validate_runtime_budget_config(config).expect("default-shaped budgets pass");

    let mut bad_peer_budget = valid_runtime_budget_config();
    bad_peer_budget.max_active_connections = 2;
    bad_peer_budget.max_connections_per_ip = 3;
    let peer_err =
        validate_runtime_budget_config(bad_peer_budget).expect_err("peer budget rejects");
    assert!(peer_err
        .to_string()
        .contains("MAX_CONNECTIONS_PER_IP must be <= MAX_ACTIVE_CONNECTIONS"));

    let mut bad_account_connection_budget = valid_runtime_budget_config();
    bad_account_connection_budget.max_active_connections = 2;
    bad_account_connection_budget.max_connections_per_ip = 2;
    bad_account_connection_budget.max_connections_per_account = 3;
    let account_connection_err = validate_runtime_budget_config(bad_account_connection_budget)
        .expect_err("account connection budget rejects");
    assert!(account_connection_err
        .to_string()
        .contains("MAX_CONNECTIONS_PER_ACCOUNT must be <= MAX_ACTIVE_CONNECTIONS"));

    let mut bad_ip_burst = valid_runtime_budget_config();
    bad_ip_burst
        .session_issue_rate_limit_config
        .requests_per_minute = 10;
    bad_ip_burst.session_issue_rate_limit_config.burst = 11;
    let ip_burst_err = validate_runtime_budget_config(bad_ip_burst).expect_err("ip burst rejects");
    assert!(ip_burst_err
        .to_string()
        .contains("SESSION_ISSUE_RATE_LIMIT_BURST"));

    let mut bad_account_burst = valid_runtime_budget_config();
    bad_account_burst
        .account_session_rate_limit_config
        .requests_per_minute = 10;
    bad_account_burst.account_session_rate_limit_config.burst = 11;
    let account_burst_err =
        validate_runtime_budget_config(bad_account_burst).expect_err("account burst rejects");
    assert!(account_burst_err
        .to_string()
        .contains("ACCOUNT_SESSION_RATE_LIMIT_BURST"));

    let mut bad_snapshot_cap = valid_runtime_budget_config();
    bad_snapshot_cap.max_snapshot_bytes = 1;
    let snapshot_err =
        validate_runtime_budget_config(bad_snapshot_cap).expect_err("snapshot cap rejects");
    assert!(snapshot_err.to_string().contains("MAX_SNAPSHOT_BYTES"));
}

#[test]
fn external_bind_requires_public_deployment_mode() {
    assert!(validate_bind_addr(false, "127.0.0.1:4107".parse().expect("addr")).is_ok());
    assert!(validate_bind_addr(false, "[::1]:4107".parse().expect("addr")).is_ok());

    let err = validate_bind_addr(false, "0.0.0.0:4107".parse().expect("addr"))
        .expect_err("external bind rejects local mode");
    let message = err.to_string();
    assert!(message.contains("BIND_ADDR"));
    assert!(message.contains("PUBLIC_DEPLOYMENT=true"));

    assert!(validate_bind_addr(true, "0.0.0.0:4107".parse().expect("addr")).is_ok());
}

#[test]
fn public_deployment_rejects_stubbed_chain_mode() {
    assert!(validate_chain_mode(false, true).is_ok());
    assert!(validate_chain_mode(true, false).is_ok());

    let err = validate_chain_mode(true, true)
        .expect_err("public deployment rejects chain mode without signer/indexer");
    let message = err.to_string();
    assert!(message.contains("CHAIN_ENABLED=true"));
    assert!(message.contains("PUBLIC_DEPLOYMENT=true"));
    assert!(message.contains("signer"));
    assert!(message.contains("indexer"));
}

#[test]
fn deployment_profile_enforces_shared_and_production_posture() {
    assert!(validate_deployment_profile(DeploymentProfile::Local, false).is_ok());
    assert!(validate_deployment_profile(DeploymentProfile::SharedPoc, true).is_ok());

    let public_local_err = validate_deployment_profile(DeploymentProfile::Local, true)
        .expect_err("public deployment requires non-local profile");
    let public_local_message = public_local_err.to_string();
    assert!(public_local_message.contains("PUBLIC_DEPLOYMENT=true"));
    assert!(public_local_message.contains("DEPLOYMENT_PROFILE=shared-poc"));

    let shared_err = validate_deployment_profile(DeploymentProfile::SharedPoc, false)
        .expect_err("shared-poc profile requires public deployment guardrails");
    let shared_message = shared_err.to_string();
    assert!(shared_message.contains("DEPLOYMENT_PROFILE=shared-poc"));
    assert!(shared_message.contains("PUBLIC_DEPLOYMENT=true"));

    let production_err = validate_deployment_profile(DeploymentProfile::Production, true)
        .expect_err("production profile rejects PoC runtime");
    let production_message = production_err.to_string();
    assert!(production_message.contains("DEPLOYMENT_PROFILE=production"));
    assert!(production_message.contains("durable database/event-store"));
    assert!(production_message.contains("signer/indexer"));
    assert!(production_message.contains("cross-process admission/rate-limit"));
}

#[test]
fn session_request_display_name_is_validated() {
    assert_eq!(
        session_display_name_from_body(b"").expect("empty body allowed"),
        None
    );
    assert_eq!(
        session_display_name_from_body(br#"{"name":"  Scout_7  "}"#)
            .expect("valid display name accepted"),
        Some("Scout_7".to_string())
    );

    let invalid_name = session_display_name_from_body(br#"{"name":"Scout<script>"}"#)
        .expect_err("invalid display name rejected");
    assert_eq!(invalid_name.0, StatusCode::BAD_REQUEST);
    assert!(invalid_name.1.contains("invalid-player-name"));

    let invalid_json =
        session_display_name_from_body(b"not-json").expect_err("invalid JSON rejected");
    assert_eq!(invalid_json.0, StatusCode::BAD_REQUEST);
    assert!(invalid_json.1.contains("invalid session request JSON"));

    let unknown_field = session_display_name_from_body(br#"{"name":"Scout","admin":true}"#)
        .expect_err("unknown session field rejected");
    assert_eq!(unknown_field.0, StatusCode::BAD_REQUEST);
    assert!(unknown_field.1.contains("invalid session request JSON"));
}

#[test]
fn session_body_requires_json_content_type_when_non_empty() {
    let empty_headers = HeaderMap::new();
    session_body_content_type(&empty_headers, b"").expect("empty body allowed");
    session_body_content_type(&empty_headers, b" \n\t").expect("whitespace body allowed");

    let mut json_headers = HeaderMap::new();
    json_headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
    session_body_content_type(&json_headers, br#"{"name":"Scout"}"#)
        .expect("JSON content type accepted");

    let missing = session_body_content_type(&empty_headers, br#"{"name":"Scout"}"#)
        .expect_err("missing content type rejected");
    assert_eq!(missing.0, StatusCode::UNSUPPORTED_MEDIA_TYPE);

    let mut text_headers = HeaderMap::new();
    text_headers.insert(CONTENT_TYPE, HeaderValue::from_static("text/plain"));
    let wrong = session_body_content_type(&text_headers, br#"{"name":"Scout"}"#)
        .expect_err("wrong content type rejected");
    assert_eq!(wrong.0, StatusCode::UNSUPPORTED_MEDIA_TYPE);
}

fn valid_runtime_budget_config() -> RuntimeBudgetConfig {
    RuntimeBudgetConfig {
        session_config: SessionConfig {
            require_session: true,
            ticket_ttl: Duration::from_secs(120),
            ticket_capacity: 2048,
        },
        session_issue_rate_limit_config: SessionIssueRateLimitConfig {
            requests_per_minute: 120,
            burst: 30,
            max_clients: 4096,
        },
        account_session_rate_limit_config: SessionIssueRateLimitConfig {
            requests_per_minute: 60,
            burst: 10,
            max_clients: 4096,
        },
        websocket_config: WebSocketConfig {
            snapshot_interval: Duration::from_millis(50),
            interest_radius: 520.0,
            heartbeat_interval: Duration::from_secs(30),
            idle_timeout: Duration::from_secs(180),
        },
        ingress_config: ClientIngressConfig {
            max_text_bytes: 4096,
            message_burst: 20,
            message_refill_per_second: 30,
            max_input_sequence_step: DEFAULT_MAX_INPUT_SEQUENCE_STEP,
            ..ClientIngressConfig::default()
        },
        max_snapshot_bytes: 65_536,
        max_admin_snapshot_bytes: 262_144,
        max_active_connections: 512,
        max_connections_per_ip: 64,
        max_connections_per_account: 4,
        http_body_limit_bytes: 4096,
        client_reject_limit: 8,
        admin_event_limit_cap: 200,
        max_journal_bytes: 16 * 1024 * 1024,
        max_settlement_outbox_bytes: 16 * 1024 * 1024,
        max_durable_line_bytes: 256 * 1024,
        max_runtime_manifest_bytes: 256 * 1024,
        max_runtime_asset_bytes: 2 * 1024 * 1024,
        max_content_objects: 10_000,
    }
}
