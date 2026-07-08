use std::sync::Arc;
use std::time::Duration;

mod durable;
mod state;

use crate::admission::{AccountConnectionCounts, PeerConnectionCounts};
use crate::config::{
    account_auth_config, account_session_rate_limit_config, admission_backend, bind_addr,
    client_ingress_config, deployment_profile, env_bool, env_optional_nonempty_string,
    env_positive_u64, env_positive_usize, origin_allowlist_config, persistence_backend,
    session_config, session_issue_rate_limit_config, validate_bind_addr, validate_chain_mode,
    validate_deployment_profile, validate_public_deployment, validate_runtime_budget_config,
    validate_supported_admission_backend, validate_supported_persistence_backend, websocket_config,
    RuntimeBudgetConfig,
};
use crate::content::WorldContent;
use crate::metrics::AppMetrics;
use crate::runtime_assets::{load_terrain_detail_authority_for_sim, RuntimeManifest};
use crate::runtime_paths::{assets_dir, client_dir, content_path};
use crate::session::{SessionAccountRateLimiter, SessionIssueRateLimiter, SessionTickets};
use crate::settlement::{self, SettlementConfig, SettlementLedger};
use crate::sim::SimWorld;
use anyhow::anyhow;
use tokio::sync::{Mutex, Semaphore};
use tracing::info;

pub(crate) use state::{AppState, RuntimeServer};

pub(crate) const SERVER_TICK_BUDGET: Duration = Duration::from_millis(50);
pub(crate) const DEFAULT_ADMIN_EVENT_LIMIT: usize = 50;

const DEFAULT_HTTP_BODY_LIMIT_BYTES: usize = 4096;
const DEFAULT_ADMIN_EVENT_LIMIT_CAP: usize = 200;
const DEFAULT_MAX_CONTENT_OBJECTS: usize = 10_000;
const DEFAULT_MAX_JOURNAL_BYTES: u64 = 16 * 1024 * 1024;
const DEFAULT_MAX_SETTLEMENT_OUTBOX_BYTES: u64 = 16 * 1024 * 1024;
const DEFAULT_MAX_RUNTIME_MANIFEST_BYTES: u64 = 256 * 1024;
const DEFAULT_MAX_RUNTIME_ASSET_BYTES: usize = 2 * 1024 * 1024;
const DEFAULT_MAX_SNAPSHOT_BYTES: usize = 65_536;
const DEFAULT_MAX_ADMIN_SNAPSHOT_BYTES: usize = 262_144;
const DEFAULT_MAX_CONNECTIONS_PER_IP: usize = 64;
const DEFAULT_MAX_CONNECTIONS_PER_ACCOUNT: usize = 4;

pub(crate) async fn initialize_runtime() -> anyhow::Result<RuntimeServer> {
    let chain_enabled = env_bool("CHAIN_ENABLED", false)?;
    let settlement_config = SettlementConfig { chain_enabled };
    let (settlement_tx, settlement_rx) = settlement::channel();
    let settlement_ledger = Arc::new(Mutex::new(SettlementLedger::default()));
    let persistence_backend_configured = std::env::var("PERSISTENCE_BACKEND").is_ok();
    let persistence_backend = persistence_backend()?;
    validate_supported_persistence_backend(persistence_backend)?;
    let durable_runtime = durable::initialize_durable_runtime(&settlement_ledger).await?;
    let max_content_objects =
        env_positive_usize("MAX_CONTENT_OBJECTS", DEFAULT_MAX_CONTENT_OBJECTS)?;
    let loaded_content = WorldContent::load_with_limits(content_path(), max_content_objects)?;
    let content_manifest = loaded_content.manifest.clone();
    let session_config = session_config()?;
    let account_auth = account_auth_config()?;
    let session_issue_rate_limit_config = session_issue_rate_limit_config()?;
    let account_session_rate_limit_config = account_session_rate_limit_config()?;
    let admission_backend_configured = std::env::var("ADMISSION_BACKEND").is_ok();
    let admission_backend = admission_backend()?;
    validate_supported_admission_backend(admission_backend)?;
    let metrics_handle = Arc::new(AppMetrics::default());
    let websocket_config = websocket_config()?;
    let ingress_config = client_ingress_config()?;
    let max_snapshot_bytes = env_positive_usize("MAX_SNAPSHOT_BYTES", DEFAULT_MAX_SNAPSHOT_BYTES)?;
    let max_admin_snapshot_bytes =
        env_positive_usize("MAX_ADMIN_SNAPSHOT_BYTES", DEFAULT_MAX_ADMIN_SNAPSHOT_BYTES)?;
    let client_reject_limit = env_positive_usize("CLIENT_REJECT_LIMIT", 8)?;
    let origin_allowlist = origin_allowlist_config()?;
    let max_active_connections = env_positive_usize("MAX_ACTIVE_CONNECTIONS", 512)?;
    let max_connections_per_ip =
        env_positive_usize("MAX_CONNECTIONS_PER_IP", DEFAULT_MAX_CONNECTIONS_PER_IP)?;
    let max_connections_per_account = env_positive_usize(
        "MAX_CONNECTIONS_PER_ACCOUNT",
        DEFAULT_MAX_CONNECTIONS_PER_ACCOUNT,
    )?;
    let admin_token = env_optional_nonempty_string("ADMIN_TOKEN")?;
    let metrics_token = env_optional_nonempty_string("METRICS_TOKEN")?;
    let deployment_profile = deployment_profile()?;
    let public_deployment = env_bool("PUBLIC_DEPLOYMENT", false)?;
    let draining = env_bool("DRAINING", false)?;
    let http_body_limit_bytes =
        env_positive_usize("HTTP_BODY_LIMIT_BYTES", DEFAULT_HTTP_BODY_LIMIT_BYTES)?;
    let admin_event_limit_cap =
        env_positive_usize("ADMIN_EVENT_LIMIT_CAP", DEFAULT_ADMIN_EVENT_LIMIT_CAP)?;
    let max_runtime_manifest_bytes = env_positive_u64(
        "MAX_RUNTIME_MANIFEST_BYTES",
        DEFAULT_MAX_RUNTIME_MANIFEST_BYTES,
    )?;
    let max_runtime_asset_bytes =
        env_positive_usize("MAX_RUNTIME_ASSET_BYTES", DEFAULT_MAX_RUNTIME_ASSET_BYTES)?;
    let addr = bind_addr()?;
    validate_runtime_budget_config(RuntimeBudgetConfig {
        session_config: session_config.clone(),
        session_issue_rate_limit_config: session_issue_rate_limit_config.clone(),
        account_session_rate_limit_config: account_session_rate_limit_config.clone(),
        websocket_config: websocket_config.clone(),
        ingress_config: ingress_config.clone(),
        max_snapshot_bytes,
        max_admin_snapshot_bytes,
        max_active_connections,
        max_connections_per_ip,
        max_connections_per_account,
        http_body_limit_bytes,
        client_reject_limit,
        admin_event_limit_cap,
        max_journal_bytes: durable_runtime.max_journal_bytes,
        max_settlement_outbox_bytes: durable_runtime.max_settlement_outbox_bytes,
        max_durable_line_bytes: durable_runtime.max_durable_line_bytes,
        max_runtime_manifest_bytes,
        max_runtime_asset_bytes,
        max_content_objects,
    })?;
    validate_deployment_profile(deployment_profile, public_deployment)?;
    validate_public_deployment(
        public_deployment,
        &session_config,
        &account_auth,
        &origin_allowlist,
        admin_token.as_deref(),
        metrics_token.as_deref(),
        durable_runtime.durable_sync_writes,
        persistence_backend_configured,
        persistence_backend,
        admission_backend_configured,
        admission_backend,
    )?;
    validate_bind_addr(public_deployment, addr)?;
    validate_chain_mode(public_deployment, settlement_config.chain_enabled)?;

    tokio::spawn(settlement::run_worker(
        settlement_config.clone(),
        settlement_rx,
        settlement_ledger.clone(),
        durable_runtime.settlement_outbox.clone(),
        metrics_handle.clone(),
    ));

    let replayed_jobs = settlement::replay_pending_jobs(
        durable_runtime.pending_settlement_jobs,
        &settlement_tx,
        &settlement_ledger,
    )
    .await?;
    if replayed_jobs > 0 {
        info!(count = replayed_jobs, "replayed pending settlement jobs");
    }
    if durable_runtime.journal_replayed_total_events > 0 {
        info!(
            total = durable_runtime.journal_replayed_total_events,
            retained = durable_runtime.journal_retained_event_count,
            "replayed journal events"
        );
    }
    let assets_dir = assets_dir();
    let runtime_manifest = RuntimeManifest::load(
        &assets_dir,
        content_manifest.clone(),
        max_runtime_manifest_bytes,
        max_runtime_asset_bytes,
    )?;
    let terrain_detail_authority =
        load_terrain_detail_authority_for_sim(&assets_dir, max_runtime_manifest_bytes)?;

    let mut sim = SimWorld::from_content_with_terrain_detail_authority(
        loaded_content.content,
        Some(terrain_detail_authority),
    )
    .map_err(|err| anyhow!(err))?;
    let replayed_resource_node_count =
        sim.apply_resource_node_replay(&durable_runtime.replayed_resource_nodes);
    if replayed_resource_node_count > 0 {
        info!(
            count = replayed_resource_node_count,
            "replayed resource node state"
        );
    }

    Ok(RuntimeServer {
        state: AppState {
            sim: Arc::new(Mutex::new(sim)),
            settlement_tx,
            settlement_ledger,
            settlement_outbox: durable_runtime.settlement_outbox,
            settlement_config,
            journal: durable_runtime.journal,
            journal_writer: durable_runtime.journal_writer,
            journal_replayed_total_events: durable_runtime.journal_replayed_total_events,
            journal_sequence_anomalies: durable_runtime.journal_sequence_anomalies,
            max_journal_bytes: durable_runtime.max_journal_bytes,
            max_settlement_outbox_bytes: durable_runtime.max_settlement_outbox_bytes,
            max_durable_line_bytes: durable_runtime.max_durable_line_bytes,
            persistence_backend,
            _journal_file_lock: durable_runtime.journal_file_lock,
            _settlement_outbox_file_lock: durable_runtime.settlement_outbox_file_lock,
            durable_sync_writes: durable_runtime.durable_sync_writes,
            max_content_objects,
            metrics: metrics_handle,
            sessions: Arc::new(Mutex::new(SessionTickets::new(
                session_config.ticket_ttl,
                session_config.ticket_capacity,
            ))),
            account_auth,
            session_issue_limiter: Arc::new(Mutex::new(SessionIssueRateLimiter::new(
                session_issue_rate_limit_config.clone(),
            ))),
            account_session_limiter: Arc::new(Mutex::new(SessionAccountRateLimiter::new(
                account_session_rate_limit_config.clone(),
            ))),
            admission_backend,
            session_config,
            session_issue_rate_limit_config,
            account_session_rate_limit_config,
            websocket_config,
            ingress_config,
            max_snapshot_bytes,
            max_admin_snapshot_bytes,
            client_reject_limit,
            origin_allowlist,
            connection_permits: Arc::new(Semaphore::new(max_active_connections)),
            max_active_connections,
            peer_connections: Arc::new(Mutex::new(PeerConnectionCounts::default())),
            max_connections_per_ip,
            account_connections: Arc::new(Mutex::new(AccountConnectionCounts::default())),
            max_connections_per_account,
            content_manifest,
            deployment_profile,
            public_deployment,
            draining,
            admin_token,
            metrics_token,
            http_body_limit_bytes,
            admin_event_limit_cap,
            runtime_manifest,
        },
        addr,
        assets_dir,
        client_dir: client_dir(),
    })
}
