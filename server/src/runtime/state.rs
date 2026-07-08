use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex, Semaphore};

use crate::admission::{AccountConnectionCounts, PeerConnectionCounts};
use crate::config::{
    AccountAuthConfig, AdmissionBackend, DeploymentProfile, OriginAllowlistConfig,
    PersistenceBackend, WebSocketConfig,
};
use crate::content::ContentManifest;
use crate::ingress::ClientIngressConfig;
use crate::journal::EventJournal;
use crate::metrics::AppMetrics;
use crate::persistence::{DurableFileLock, JsonlEventWriter};
use crate::runtime_assets::RuntimeManifest;
use crate::session::{
    SessionAccountRateLimiter, SessionConfig, SessionIssueRateLimitConfig, SessionIssueRateLimiter,
    SessionTickets,
};
use crate::settlement::{
    SettlementConfig, SettlementJob, SettlementLedgerHandle, SettlementOutboxHandle,
};
use crate::sim::SimWorld;

pub(crate) struct RuntimeServer {
    pub(crate) state: AppState,
    pub(crate) addr: SocketAddr,
    pub(crate) assets_dir: PathBuf,
    pub(crate) client_dir: PathBuf,
}

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) sim: Arc<Mutex<SimWorld>>,
    pub(crate) settlement_tx: mpsc::Sender<SettlementJob>,
    pub(crate) settlement_ledger: SettlementLedgerHandle,
    pub(crate) settlement_outbox: SettlementOutboxHandle,
    pub(crate) settlement_config: SettlementConfig,
    pub(crate) journal: Arc<Mutex<EventJournal>>,
    pub(crate) journal_writer: Arc<Mutex<JsonlEventWriter>>,
    pub(crate) journal_replayed_total_events: usize,
    pub(crate) journal_sequence_anomalies: usize,
    pub(crate) max_journal_bytes: u64,
    pub(crate) max_settlement_outbox_bytes: u64,
    pub(crate) max_durable_line_bytes: usize,
    pub(crate) persistence_backend: PersistenceBackend,
    pub(crate) _journal_file_lock: Arc<DurableFileLock>,
    pub(crate) _settlement_outbox_file_lock: Arc<DurableFileLock>,
    pub(crate) durable_sync_writes: bool,
    pub(crate) max_content_objects: usize,
    pub(crate) metrics: Arc<AppMetrics>,
    pub(crate) sessions: Arc<Mutex<SessionTickets>>,
    pub(crate) session_config: SessionConfig,
    pub(crate) account_auth: AccountAuthConfig,
    pub(crate) session_issue_limiter: Arc<Mutex<SessionIssueRateLimiter>>,
    pub(crate) session_issue_rate_limit_config: SessionIssueRateLimitConfig,
    pub(crate) account_session_limiter: Arc<Mutex<SessionAccountRateLimiter>>,
    pub(crate) account_session_rate_limit_config: SessionIssueRateLimitConfig,
    pub(crate) admission_backend: AdmissionBackend,
    pub(crate) websocket_config: WebSocketConfig,
    pub(crate) ingress_config: ClientIngressConfig,
    pub(crate) max_snapshot_bytes: usize,
    pub(crate) max_admin_snapshot_bytes: usize,
    pub(crate) client_reject_limit: usize,
    pub(crate) origin_allowlist: OriginAllowlistConfig,
    pub(crate) connection_permits: Arc<Semaphore>,
    pub(crate) max_active_connections: usize,
    pub(crate) peer_connections: Arc<Mutex<PeerConnectionCounts>>,
    pub(crate) max_connections_per_ip: usize,
    pub(crate) account_connections: Arc<Mutex<AccountConnectionCounts>>,
    pub(crate) max_connections_per_account: usize,
    pub(crate) content_manifest: ContentManifest,
    pub(crate) deployment_profile: DeploymentProfile,
    pub(crate) public_deployment: bool,
    pub(crate) draining: bool,
    pub(crate) admin_token: Option<String>,
    pub(crate) metrics_token: Option<String>,
    pub(crate) http_body_limit_bytes: usize,
    pub(crate) admin_event_limit_cap: usize,
    pub(crate) runtime_manifest: RuntimeManifest,
}
