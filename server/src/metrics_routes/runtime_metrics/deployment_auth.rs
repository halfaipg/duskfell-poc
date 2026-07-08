use super::{append_metric, RuntimeMetricValues};
use crate::{AdmissionBackend, AppState, DeploymentProfile, PersistenceBackend};

pub(super) fn append_deployment_auth_metrics(
    output: &mut String,
    state: &AppState,
    _values: &RuntimeMetricValues,
) {
    append_metric(
        output,
        "sundermere_origin_allowlist_enabled",
        "Whether HTTP Origin checks are enforced for session issuance and WebSocket upgrades.",
        "gauge",
        u64::from(state.origin_allowlist.enabled()),
    );
    append_metric(
        output,
        "sundermere_origin_allowed_origins",
        "Configured count of exact-match allowed Origins.",
        "gauge",
        state.origin_allowlist.allowed_count() as u64,
    );
    append_metric(
        output,
        "sundermere_public_deployment",
        "Whether public deployment startup guardrails were required.",
        "gauge",
        u64::from(state.public_deployment),
    );
    append_metric(
        output,
        "sundermere_deployment_profile_local",
        "Whether DEPLOYMENT_PROFILE is local.",
        "gauge",
        u64::from(state.deployment_profile == DeploymentProfile::Local),
    );
    append_metric(
        output,
        "sundermere_deployment_profile_shared_poc",
        "Whether DEPLOYMENT_PROFILE is shared-poc.",
        "gauge",
        u64::from(state.deployment_profile == DeploymentProfile::SharedPoc),
    );
    append_metric(
        output,
        "sundermere_deployment_profile_production",
        "Whether DEPLOYMENT_PROFILE is production.",
        "gauge",
        u64::from(state.deployment_profile == DeploymentProfile::Production),
    );
    append_metric(
        output,
        "sundermere_persistence_backend_jsonl",
        "Whether PERSISTENCE_BACKEND is jsonl.",
        "gauge",
        u64::from(state.persistence_backend == PersistenceBackend::Jsonl),
    );
    append_metric(
        output,
        "sundermere_persistence_backend_postgres",
        "Whether PERSISTENCE_BACKEND is postgres.",
        "gauge",
        u64::from(state.persistence_backend == PersistenceBackend::Postgres),
    );
    append_metric(
        output,
        "sundermere_admission_backend_in_memory",
        "Whether ADMISSION_BACKEND is in-memory.",
        "gauge",
        u64::from(state.admission_backend == AdmissionBackend::InMemory),
    );
    append_metric(
        output,
        "sundermere_admission_backend_redis",
        "Whether ADMISSION_BACKEND is redis.",
        "gauge",
        u64::from(state.admission_backend == AdmissionBackend::Redis),
    );
    append_metric(
        output,
        "sundermere_draining",
        "Whether this shard is refusing new session admission for drain or rollback.",
        "gauge",
        u64::from(state.draining),
    );
    append_metric(
        output,
        "sundermere_require_session",
        "Whether WebSocket session tickets are required.",
        "gauge",
        u64::from(state.session_config.require_session),
    );
    append_metric(
        output,
        "sundermere_require_account",
        "Whether account authentication is required before session tickets are issued.",
        "gauge",
        u64::from(state.account_auth.require_account),
    );
    append_metric(
        output,
        "sundermere_dev_account_token_configured",
        "Whether the temporary development account bearer token is configured.",
        "gauge",
        u64::from(state.account_auth.dev_account_token_configured()),
    );
    append_metric(
        output,
        "sundermere_account_auth_mode_dev_token",
        "Whether account authentication uses the temporary development bearer token mode.",
        "gauge",
        u64::from(state.account_auth.mode_name() == "dev-token"),
    );
    append_metric(
        output,
        "sundermere_account_auth_mode_jwt_hs256",
        "Whether account authentication validates HS256 JWT bearer tokens.",
        "gauge",
        u64::from(state.account_auth.mode_name() == "jwt-hs256"),
    );
    append_metric(
        output,
        "sundermere_account_jwt_issuer_configured",
        "Whether account JWT issuer validation is configured.",
        "gauge",
        u64::from(state.account_auth.jwt_issuer_configured()),
    );
    append_metric(
        output,
        "sundermere_account_jwt_audience_configured",
        "Whether account JWT audience validation is configured.",
        "gauge",
        u64::from(state.account_auth.jwt_audience_configured()),
    );
    append_metric(
        output,
        "sundermere_chain_enabled",
        "Whether chain settlement mode is enabled.",
        "gauge",
        u64::from(state.settlement_config.chain_enabled),
    );
    append_metric(
        output,
        "sundermere_http_body_limit_bytes",
        "Configured maximum HTTP request body size in bytes.",
        "gauge",
        state.http_body_limit_bytes as u64,
    );
    append_metric(
        output,
        "sundermere_admin_event_limit_cap",
        "Configured maximum events returned by one admin events query.",
        "gauge",
        state.admin_event_limit_cap as u64,
    );
}
