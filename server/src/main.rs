mod content;
mod ingress;
mod journal;
mod metrics;
mod persistence;
mod protocol;
mod session;
mod settlement;
mod sim;
mod spatial;
mod terrain;

use std::collections::HashMap;
use std::fs;
use std::net::{IpAddr, SocketAddr};
use std::path::Component;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context};
use axum::body::{Body, Bytes};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::ConnectInfo;
use axum::extract::DefaultBodyLimit;
use axum::extract::Query;
use axum::extract::State;
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, ORIGIN};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use content::{ContentManifest, WorldContent};
use ingress::{
    ClientIngress, ClientIngressConfig, IngressRejectReason, DEFAULT_MAX_CLIENT_TEXT_BYTES,
    DEFAULT_MESSAGE_BURST, DEFAULT_MESSAGE_REFILL_PER_SECOND,
};
use journal::{EventJournal, JournalEvent, JournalEventKind, DEFAULT_RETAINED_EVENTS};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use metrics::AppMetrics;
use persistence::{
    ensure_file_within_size, load_journal_events, JsonlEventWriter, DEFAULT_MAX_DURABLE_LINE_BYTES,
};
use protocol::{ClientMessage, NoticeLevel, PlayerId, ServerMessage};
use serde::{Deserialize, Serialize};
use session::{
    SessionAccountRateLimiter, SessionAuth, SessionConfig, SessionIssueError,
    SessionIssueRateLimitConfig, SessionIssueRateLimiter, SessionRejectReason, SessionTickets,
};
use settlement::{
    SettlementConfig, SettlementJob, SettlementLedger, SettlementLedgerHandle, SettlementOutbox,
    SettlementOutboxHandle,
};
use sha2::{Digest, Sha256};
use sim::{validate_player_name, PlayerInput, PlayerNameError, SimWorld, INTEREST_RADIUS};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex, OwnedSemaphorePermit, Semaphore};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing::{debug_span, error, info};
use uuid::Uuid;

const SERVER_TICK_BUDGET: Duration = Duration::from_millis(50);
const DEFAULT_HTTP_BODY_LIMIT_BYTES: usize = 4096;
const DEFAULT_ADMIN_EVENT_LIMIT: usize = 50;
const DEFAULT_ADMIN_EVENT_LIMIT_CAP: usize = 200;
const DEFAULT_MAX_CONTENT_OBJECTS: usize = 10_000;
const DEFAULT_MAX_JOURNAL_BYTES: u64 = 16 * 1024 * 1024;
const DEFAULT_MAX_SETTLEMENT_OUTBOX_BYTES: u64 = 16 * 1024 * 1024;
const DEFAULT_MAX_RUNTIME_MANIFEST_BYTES: u64 = 256 * 1024;
const DEFAULT_MAX_RUNTIME_ASSET_BYTES: usize = 2 * 1024 * 1024;
const DEFAULT_MAX_SNAPSHOT_BYTES: usize = 65_536;
const DEFAULT_MAX_ADMIN_SNAPSHOT_BYTES: usize = 262_144;
const DEFAULT_MAX_CONNECTIONS_PER_IP: usize = 64;
const DEFAULT_SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS: usize = 4096;
const DEFAULT_ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE: u32 = 60;
const DEFAULT_ACCOUNT_SESSION_RATE_LIMIT_BURST: u32 = 10;
const DEFAULT_ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS: usize = 4096;
const MAX_ACCOUNT_SUBJECT_BYTES: usize = 128;
const MAX_AUTH_TOKEN_BYTES: usize = 4096;
const MAX_ALLOWED_ORIGINS: usize = 16;
const MAX_ORIGIN_BYTES: usize = 512;
const MIN_PUBLIC_DEPLOYMENT_TOKEN_BYTES: usize = 24;
const CONTENT_SECURITY_POLICY: &str = concat!(
    "default-src 'self'; ",
    "connect-src 'self' ws: wss:; ",
    "img-src 'self' data:; ",
    "style-src 'self'; ",
    "script-src 'self'; ",
    "base-uri 'none'; ",
    "object-src 'none'; ",
    "frame-ancestors 'none'"
);

#[derive(Clone)]
struct AppState {
    sim: Arc<Mutex<SimWorld>>,
    settlement_tx: mpsc::Sender<SettlementJob>,
    settlement_ledger: SettlementLedgerHandle,
    settlement_outbox: SettlementOutboxHandle,
    settlement_config: SettlementConfig,
    journal: Arc<Mutex<EventJournal>>,
    journal_writer: Arc<Mutex<JsonlEventWriter>>,
    journal_replayed_total_events: usize,
    journal_sequence_anomalies: usize,
    max_journal_bytes: u64,
    max_settlement_outbox_bytes: u64,
    max_durable_line_bytes: usize,
    durable_sync_writes: bool,
    max_content_objects: usize,
    metrics: Arc<AppMetrics>,
    sessions: Arc<Mutex<SessionTickets>>,
    session_config: SessionConfig,
    account_auth: AccountAuthConfig,
    session_issue_limiter: Arc<Mutex<SessionIssueRateLimiter>>,
    session_issue_rate_limit_config: SessionIssueRateLimitConfig,
    account_session_limiter: Arc<Mutex<SessionAccountRateLimiter>>,
    account_session_rate_limit_config: SessionIssueRateLimitConfig,
    websocket_config: WebSocketConfig,
    ingress_config: ClientIngressConfig,
    max_snapshot_bytes: usize,
    max_admin_snapshot_bytes: usize,
    client_reject_limit: usize,
    origin_allowlist: OriginAllowlistConfig,
    connection_permits: Arc<Semaphore>,
    max_active_connections: usize,
    peer_connections: Arc<Mutex<PeerConnectionCounts>>,
    max_connections_per_ip: usize,
    content_manifest: ContentManifest,
    public_deployment: bool,
    draining: bool,
    admin_token: Option<String>,
    metrics_token: Option<String>,
    http_body_limit_bytes: usize,
    admin_event_limit_cap: usize,
    runtime_manifest: RuntimeManifest,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "sundermere_server=info,tower_http=info".into()),
        )
        .init();

    let chain_enabled = env_bool("CHAIN_ENABLED", false)?;
    let settlement_config = SettlementConfig { chain_enabled };
    let (settlement_tx, settlement_rx) = settlement::channel();
    let settlement_ledger = Arc::new(Mutex::new(SettlementLedger::default()));
    let max_journal_bytes = env_positive_u64("MAX_JOURNAL_BYTES", DEFAULT_MAX_JOURNAL_BYTES)?;
    let max_settlement_outbox_bytes = env_positive_u64(
        "MAX_SETTLEMENT_OUTBOX_BYTES",
        DEFAULT_MAX_SETTLEMENT_OUTBOX_BYTES,
    )?;
    let durable_sync_writes = env_bool("DURABLE_SYNC_WRITES", false)?;
    let max_durable_line_bytes =
        env_positive_usize("MAX_DURABLE_LINE_BYTES", DEFAULT_MAX_DURABLE_LINE_BYTES)?;
    let settlement_outbox_path = settlement_outbox_path();
    ensure_file_within_size(
        &settlement_outbox_path,
        max_settlement_outbox_bytes,
        "MAX_SETTLEMENT_OUTBOX_BYTES",
        "settlement outbox",
    )?;
    let (settlement_outbox, pending_settlement_jobs, confirmed_receipts) =
        SettlementOutbox::open_with_options(
            settlement_outbox_path,
            durable_sync_writes,
            max_durable_line_bytes,
        )?;
    let settlement_outbox = Arc::new(Mutex::new(settlement_outbox));
    settlement::seed_confirmed_receipts(confirmed_receipts, &settlement_ledger).await;
    let journal_retained_events =
        env_positive_usize("JOURNAL_RETAINED_EVENTS", DEFAULT_RETAINED_EVENTS)?;
    let journal_path = journal_path();
    ensure_file_within_size(
        &journal_path,
        max_journal_bytes,
        "MAX_JOURNAL_BYTES",
        "journal",
    )?;
    let replayed_journal = load_journal_events(
        &journal_path,
        journal_retained_events,
        max_durable_line_bytes,
    )?;
    let replayed_journal_event_count = replayed_journal.total_events;
    let journal = Arc::new(Mutex::new(EventJournal::from_replayed(
        replayed_journal.events.clone(),
        replayed_journal.next_sequence,
        journal_retained_events,
    )));
    let journal_writer = Arc::new(Mutex::new(JsonlEventWriter::open_with_sync(
        journal_path,
        durable_sync_writes,
    )?));
    let max_content_objects =
        env_positive_usize("MAX_CONTENT_OBJECTS", DEFAULT_MAX_CONTENT_OBJECTS)?;
    let loaded_content = WorldContent::load_with_limits(content_path(), max_content_objects)?;
    let content_manifest = loaded_content.manifest.clone();
    let session_config = session_config()?;
    let account_auth = account_auth_config()?;
    let session_issue_rate_limit_config = session_issue_rate_limit_config()?;
    let account_session_rate_limit_config = account_session_rate_limit_config()?;
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
    let admin_token = env_optional_nonempty_string("ADMIN_TOKEN")?;
    let metrics_token = env_optional_nonempty_string("METRICS_TOKEN")?;
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
    validate_public_deployment(
        public_deployment,
        &session_config,
        &account_auth,
        &origin_allowlist,
        admin_token.as_deref(),
        metrics_token.as_deref(),
    )?;
    validate_bind_addr(public_deployment, addr)?;
    validate_chain_mode(public_deployment, settlement_config.chain_enabled)?;

    tokio::spawn(settlement::run_worker(
        settlement_config.clone(),
        settlement_rx,
        settlement_ledger.clone(),
        settlement_outbox.clone(),
        metrics_handle.clone(),
    ));

    let replayed_jobs = settlement::replay_pending_jobs(
        pending_settlement_jobs,
        &settlement_tx,
        &settlement_ledger,
    )
    .await?;
    if replayed_jobs > 0 {
        info!(count = replayed_jobs, "replayed pending settlement jobs");
    }
    if replayed_journal.total_events > 0 {
        info!(
            total = replayed_journal.total_events,
            retained = replayed_journal.events.len(),
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

    let state = AppState {
        sim: Arc::new(Mutex::new(SimWorld::from_content(loaded_content.content))),
        settlement_tx,
        settlement_ledger,
        settlement_outbox,
        settlement_config,
        journal,
        journal_writer,
        journal_replayed_total_events: replayed_journal_event_count,
        journal_sequence_anomalies: replayed_journal.sequence_anomalies,
        max_journal_bytes,
        max_settlement_outbox_bytes,
        max_durable_line_bytes,
        durable_sync_writes,
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
        content_manifest,
        public_deployment,
        draining,
        admin_token,
        metrics_token,
        http_body_limit_bytes,
        admin_event_limit_cap,
        runtime_manifest,
    };

    tokio::spawn(run_tick_loop(state.clone()));

    let client_dir = client_dir();
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/api/session", post(issue_session))
        .route("/api/snapshot", get(snapshot))
        .route("/metrics", get(metrics))
        .route("/admin/events", get(admin_events))
        .route("/admin/ownership", get(admin_ownership))
        .route("/admin/runtime", get(admin_runtime))
        .route("/admin/summary", get(admin_summary))
        .route("/ws", get(ws_handler))
        .nest_service("/assets", ServeDir::new(assets_dir))
        .nest_service("/", ServeDir::new(client_dir))
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(http_body_limit_bytes))
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &Request<Body>| {
                debug_span!(
                    "request",
                    method = %request.method(),
                    path = %sanitized_trace_path(request.uri()),
                    version = ?request.version(),
                )
            }),
        )
        .layer(middleware::from_fn(add_http_hardening_headers))
        .with_state(state);

    let listener = TcpListener::bind(addr).await?;
    info!(%addr, "Duskfell PoC server listening");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(err) = tokio::signal::ctrl_c().await {
            error!(%err, "failed to install ctrl-c shutdown handler");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(err) => {
                error!(%err, "failed to install sigterm shutdown handler");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    info!("shutdown signal received");
}

async fn healthz() -> &'static str {
    "ok"
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeManifest {
    app: RuntimeAppManifest,
    content: ContentManifest,
    assets: RuntimeAssetManifests,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeAppManifest {
    game: &'static str,
    chain: &'static str,
    ticker: &'static str,
    server_crate: &'static str,
    server_version: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    build_git_sha: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeAssetManifests {
    sprites: RuntimeAssetManifest,
    terrain: RuntimeAssetManifest,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeAssetManifest {
    kind: &'static str,
    schema_version: String,
    path: String,
    manifest_fingerprint: String,
    manifest_bytes: u64,
    max_manifest_bytes: u64,
    max_image_bytes: usize,
    projection: RuntimeProjection,
    entry_count: usize,
    images: Vec<RuntimeAssetImage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeProjection {
    kind: String,
    tile_width: u64,
    tile_height: u64,
    tile_aspect_ratio: f64,
    axis_angle_degrees: u64,
    height_axis: String,
    units_per_tile: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeAssetImage {
    id: String,
    image: String,
    sha256: String,
    sha256_verified: bool,
    bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    approval_state: Option<String>,
}

impl RuntimeManifest {
    fn load(
        assets_dir: &Path,
        content: ContentManifest,
        max_runtime_manifest_bytes: u64,
        max_runtime_asset_bytes: usize,
    ) -> anyhow::Result<Self> {
        Ok(Self {
            app: RuntimeAppManifest {
                game: "Duskfell",
                chain: "Base",
                ticker: "$DUSK",
                server_crate: env!("CARGO_PKG_NAME"),
                server_version: env!("CARGO_PKG_VERSION"),
                build_git_sha: option_env!("GIT_SHA"),
            },
            content,
            assets: RuntimeAssetManifests {
                sprites: load_sprite_runtime_manifest(
                    assets_dir,
                    max_runtime_manifest_bytes,
                    max_runtime_asset_bytes,
                )?,
                terrain: load_terrain_runtime_manifest(
                    assets_dir,
                    max_runtime_manifest_bytes,
                    max_runtime_asset_bytes,
                )?,
            },
        })
    }
}

fn load_sprite_runtime_manifest(
    assets_dir: &Path,
    max_runtime_manifest_bytes: u64,
    max_runtime_asset_bytes: usize,
) -> anyhow::Result<RuntimeAssetManifest> {
    let manifest_path = assets_dir.join("sprites").join("manifest.json");
    ensure_file_within_size(
        &manifest_path,
        max_runtime_manifest_bytes,
        "MAX_RUNTIME_MANIFEST_BYTES",
        "sprite manifest",
    )?;
    let raw = fs::read_to_string(&manifest_path)
        .with_context(|| format!("failed to read {}", manifest_path.display()))?;
    let json: serde_json::Value = serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse {}", manifest_path.display()))?;
    let schema_version = required_string(&json, "schemaVersion")?;
    let projection = runtime_projection(&json)?;
    let sheets = json
        .get("sheets")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| anyhow!("{} sheets must be an array", manifest_path.display()))?;
    let image_root = manifest_path
        .parent()
        .expect("sprite manifest has parent directory");
    let images = sheets
        .iter()
        .enumerate()
        .map(|(index, sheet)| {
            let id = required_string(sheet, "id")
                .with_context(|| format!("sprites.sheets[{index}].id"))?;
            let image = required_string(sheet, "image")
                .with_context(|| format!("sprites.sheets[{index}].image"))?;
            let sha256 = required_string(sheet, "imageSha256")
                .with_context(|| format!("sprites.sheets[{index}].imageSha256"))?;
            validate_sha256_pin(&sha256)
                .with_context(|| format!("sprites.sheets[{index}].imageSha256"))?;
            let bytes =
                verified_runtime_image_bytes(image_root, &image, &sha256, max_runtime_asset_bytes)?;
            let approval_state = sheet
                .pointer("/approval/state")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);
            Ok(RuntimeAssetImage {
                id,
                image,
                sha256,
                sha256_verified: true,
                bytes,
                approval_state,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;

    Ok(RuntimeAssetManifest {
        kind: "sprites",
        schema_version,
        path: manifest_path.display().to_string(),
        manifest_fingerprint: stable_runtime_fingerprint(raw.as_bytes()),
        manifest_bytes: raw.len() as u64,
        max_manifest_bytes: max_runtime_manifest_bytes,
        max_image_bytes: max_runtime_asset_bytes,
        projection,
        entry_count: sheets.len(),
        images,
    })
}

fn load_terrain_runtime_manifest(
    assets_dir: &Path,
    max_runtime_manifest_bytes: u64,
    max_runtime_asset_bytes: usize,
) -> anyhow::Result<RuntimeAssetManifest> {
    let manifest_path = assets_dir.join("terrain").join("manifest.json");
    ensure_file_within_size(
        &manifest_path,
        max_runtime_manifest_bytes,
        "MAX_RUNTIME_MANIFEST_BYTES",
        "terrain manifest",
    )?;
    let raw = fs::read_to_string(&manifest_path)
        .with_context(|| format!("failed to read {}", manifest_path.display()))?;
    let json: serde_json::Value = serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse {}", manifest_path.display()))?;
    let schema_version = required_string(&json, "schemaVersion")?;
    let projection = runtime_projection(&json)?;
    let tiles = json
        .get("tiles")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| anyhow!("{} tiles must be an array", manifest_path.display()))?;
    let tile_sheet = json
        .get("tileSheet")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| anyhow!("{} tileSheet must be an object", manifest_path.display()))?;
    let image_root = manifest_path
        .parent()
        .expect("terrain manifest has parent directory");
    let id = required_object_string(tile_sheet, "id").context("terrain.tileSheet.id")?;
    let image = required_object_string(tile_sheet, "image").context("terrain.tileSheet.image")?;
    let sha256 =
        required_object_string(tile_sheet, "sha256").context("terrain.tileSheet.sha256")?;
    validate_sha256_pin(&sha256).context("terrain.tileSheet.sha256")?;
    let bytes = verified_runtime_image_bytes(image_root, &image, &sha256, max_runtime_asset_bytes)?;
    let approval_state = json
        .pointer("/approval/state")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);

    Ok(RuntimeAssetManifest {
        kind: "terrain",
        schema_version,
        path: manifest_path.display().to_string(),
        manifest_fingerprint: stable_runtime_fingerprint(raw.as_bytes()),
        manifest_bytes: raw.len() as u64,
        max_manifest_bytes: max_runtime_manifest_bytes,
        max_image_bytes: max_runtime_asset_bytes,
        projection,
        entry_count: tiles.len(),
        images: vec![RuntimeAssetImage {
            id,
            image,
            sha256,
            sha256_verified: true,
            bytes,
            approval_state,
        }],
    })
}

fn runtime_projection(json: &serde_json::Value) -> anyhow::Result<RuntimeProjection> {
    let projection = json
        .get("projection")
        .ok_or_else(|| anyhow!("projection must be present"))?;
    Ok(RuntimeProjection {
        kind: required_string(projection, "kind").context("projection.kind")?,
        tile_width: required_u64(projection, "tileWidth").context("projection.tileWidth")?,
        tile_height: required_u64(projection, "tileHeight").context("projection.tileHeight")?,
        tile_aspect_ratio: required_f64(projection, "tileAspectRatio")
            .context("projection.tileAspectRatio")?,
        axis_angle_degrees: required_u64(projection, "axisAngleDegrees")
            .context("projection.axisAngleDegrees")?,
        height_axis: required_string(projection, "heightAxis").context("projection.heightAxis")?,
        units_per_tile: required_u64(projection, "unitsPerTile")
            .context("projection.unitsPerTile")?,
    })
}

fn verified_runtime_image_bytes(
    root: &Path,
    image: &str,
    expected_sha256: &str,
    max_runtime_asset_bytes: usize,
) -> anyhow::Result<u64> {
    if !is_safe_relative_asset_path(image) {
        return Err(anyhow!(
            "asset image path is not a safe relative path: {image}"
        ));
    }
    let image_path = root.join(image);
    let metadata = image_path
        .metadata()
        .with_context(|| format!("failed to stat asset image {}", image_path.display()))?;
    if !metadata.is_file() {
        return Err(anyhow!(
            "asset image is not a file: {}",
            image_path.display()
        ));
    }
    let image_bytes = metadata.len();
    if image_bytes > max_runtime_asset_bytes as u64 {
        return Err(anyhow!(
            "asset image exceeded MAX_RUNTIME_ASSET_BYTES for {}: bytes={} max={}",
            image_path.display(),
            image_bytes,
            max_runtime_asset_bytes
        ));
    }
    let bytes = fs::read(&image_path)
        .with_context(|| format!("failed to read asset image {}", image_path.display()))?;
    let actual_sha256 = sha256_hex(&bytes);
    if actual_sha256 != expected_sha256 {
        return Err(anyhow!(
            "asset image SHA-256 mismatch for {}: manifest={} actual={}",
            image_path.display(),
            expected_sha256,
            actual_sha256
        ));
    }
    Ok(image_bytes)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn required_string(json: &serde_json::Value, field: &str) -> anyhow::Result<String> {
    json.get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| anyhow!("{field} must be a string"))
}

fn required_object_string(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> anyhow::Result<String> {
    object
        .get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| anyhow!("{field} must be a string"))
}

fn required_u64(json: &serde_json::Value, field: &str) -> anyhow::Result<u64> {
    json.get(field)
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| anyhow!("{field} must be an unsigned integer"))
}

fn required_f64(json: &serde_json::Value, field: &str) -> anyhow::Result<f64> {
    let value = json
        .get(field)
        .and_then(serde_json::Value::as_f64)
        .ok_or_else(|| anyhow!("{field} must be a number"))?;
    if !value.is_finite() || value <= 0.0 {
        return Err(anyhow!("{field} must be a positive finite number"));
    }
    Ok(value)
}

fn validate_sha256_pin(value: &str) -> anyhow::Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(anyhow!("must be a lowercase SHA-256 hex digest"));
    }
    Ok(())
}

fn is_safe_relative_asset_path(value: &str) -> bool {
    let path = Path::new(value);
    !path.is_absolute()
        && !value.is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn stable_runtime_fingerprint(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64:{hash:016x}")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadinessCheck {
    name: &'static str,
    ok: bool,
    detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadinessStatus {
    ready: bool,
    checks: Vec<ReadinessCheck>,
    content: ContentManifest,
}

async fn readyz(State(state): State<AppState>) -> impl IntoResponse {
    let journal_path = state.journal_writer.lock().await.path().to_path_buf();
    let settlement_outbox_path = state.settlement_outbox.lock().await.path().to_path_buf();
    let journal_path_exists = journal_path.exists();
    let settlement_outbox_path_exists = settlement_outbox_path.exists();
    let journal_dir = durable_parent_status(&journal_path);
    let settlement_outbox_dir = durable_parent_status(&settlement_outbox_path);
    let connection_permits = state.connection_permits.available_permits();
    let (session_pending_tickets, session_ticket_capacity) = {
        let mut sessions = state.sessions.lock().await;
        (sessions.pending_count(), sessions.capacity())
    };

    let mut checks = Vec::new();
    checks.push(ReadinessCheck {
        name: "shardNotDraining",
        ok: !state.draining,
        detail: if state.draining {
            "shard is draining and refusing new sessions".to_string()
        } else {
            "shard is accepting new sessions".to_string()
        },
    });
    checks.push(ReadinessCheck {
        name: "contentLoaded",
        ok: state.content_manifest.object_count > 0,
        detail: format!(
            "{} objects loaded from {}",
            state.content_manifest.object_count, state.content_manifest.schema_version
        ),
    });
    checks.push(ReadinessCheck {
        name: "settlementQueueOpen",
        ok: !state.settlement_tx.is_closed(),
        detail: if state.settlement_tx.is_closed() {
            "settlement queue is closed".to_string()
        } else {
            "settlement queue is accepting jobs".to_string()
        },
    });
    checks.push(settlement_queue_capacity_check(&state.settlement_tx));
    checks.push(ReadinessCheck {
        name: "journalFilePresent",
        ok: journal_path_exists,
        detail: if journal_path_exists {
            "journal file exists".to_string()
        } else {
            "journal file is missing".to_string()
        },
    });
    checks.push(ReadinessCheck {
        name: "journalDirWritable",
        ok: journal_dir.ok,
        detail: journal_dir.detail,
    });
    checks.push(ReadinessCheck {
        name: "settlementOutboxFilePresent",
        ok: settlement_outbox_path_exists,
        detail: if settlement_outbox_path_exists {
            "settlement outbox file exists".to_string()
        } else {
            "settlement outbox file is missing".to_string()
        },
    });
    checks.push(ReadinessCheck {
        name: "settlementOutboxDirWritable",
        ok: settlement_outbox_dir.ok,
        detail: settlement_outbox_dir.detail,
    });
    checks.push(durable_persistence_check(&state.metrics));
    checks.push(ReadinessCheck {
        name: "connectionCapacityAvailable",
        ok: connection_permits > 0,
        detail: format!("{connection_permits} websocket permits available"),
    });
    checks.push(ReadinessCheck {
        name: "sessionTicketCapacityAvailable",
        ok: !state.session_config.require_session
            || session_pending_tickets < session_ticket_capacity,
        detail: format!(
            "{session_pending_tickets}/{session_ticket_capacity} pending session tickets"
        ),
    });

    let ready = checks.iter().all(|check| check.ok);
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status,
        Json(ReadinessStatus {
            ready,
            checks,
            content: state.content_manifest.clone(),
        }),
    )
}

fn durable_persistence_check(metrics: &AppMetrics) -> ReadinessCheck {
    let journal_failures = metrics.durable_journal_persist_failed_total();
    let settlement_failures = metrics.durable_settlement_persist_failed_total();
    ReadinessCheck {
        name: "durablePersistenceHealthy",
        ok: journal_failures == 0 && settlement_failures == 0,
        detail: format!(
            "{journal_failures} journal persist failures, {settlement_failures} settlement persist failures"
        ),
    }
}

fn settlement_queue_capacity_check(tx: &mpsc::Sender<SettlementJob>) -> ReadinessCheck {
    let available = tx.capacity();
    let maximum = tx.max_capacity();
    ReadinessCheck {
        name: "settlementQueueCapacityAvailable",
        ok: available > 0,
        detail: format!("{available}/{maximum} settlement queue slots available"),
    }
}

#[derive(Debug)]
struct DurableParentStatus {
    ok: bool,
    detail: String,
}

fn durable_parent_status(path: &Path) -> DurableParentStatus {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));

    match parent.metadata() {
        Ok(metadata) if metadata.is_dir() && !metadata.permissions().readonly() => {
            DurableParentStatus {
                ok: true,
                detail: format!("{} exists and is not read-only", parent.display()),
            }
        }
        Ok(metadata) if !metadata.is_dir() => DurableParentStatus {
            ok: false,
            detail: format!("{} is not a directory", parent.display()),
        },
        Ok(_) => DurableParentStatus {
            ok: false,
            detail: format!("{} is read-only", parent.display()),
        },
        Err(err) => DurableParentStatus {
            ok: false,
            detail: format!("{} is not accessible: {err}", parent.display()),
        },
    }
}

async fn snapshot(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, (StatusCode, String)> {
    authorize_admin(&state, &headers)?;
    let settlement = state
        .settlement_ledger
        .lock()
        .await
        .snapshot(state.settlement_config.chain_enabled);
    let snapshot = state.sim.lock().await.snapshot(settlement);
    let text = serde_json::to_string(&snapshot).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to serialize snapshot: {err}"),
        )
    })?;
    if text.len() > state.max_admin_snapshot_bytes {
        state.metrics.admin_snapshot_payload_rejected();
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            format!(
                "admin snapshot payload exceeded MAX_ADMIN_SNAPSHOT_BYTES: bytes={} max={}",
                text.len(),
                state.max_admin_snapshot_bytes
            ),
        ));
    }

    Ok(([(CONTENT_TYPE, "application/json")], text).into_response())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionTicketResponse {
    session_token: String,
    session_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    account_subject: Option<String>,
    expires_in_seconds: u64,
    require_session: bool,
    require_account: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionTicketRequest {
    name: Option<String>,
}

async fn issue_session(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<SessionTicketResponse>, (StatusCode, String)> {
    authorize_origin(&state, &headers)?;
    if state.draining {
        state.metrics.session_draining_rejected();
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "shard is draining and refusing new sessions".to_string(),
        ));
    }
    if !state.session_issue_limiter.lock().await.allow(addr.ip()) {
        state.metrics.session_issue_rate_limited();
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "session issue rate limit exceeded".to_string(),
        ));
    }
    let account_subject = authorize_account_session_issue(&state, &headers)?;
    if let Some(account_subject) = account_subject.as_deref() {
        if !state
            .account_session_limiter
            .lock()
            .await
            .allow(account_subject)
        {
            state.metrics.session_account_rate_limited();
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                "account session issue rate limit exceeded".to_string(),
            ));
        }
    }
    let display_name = session_display_name_from_body(&body).map_err(|err| {
        if err.1.contains("invalid-player-name") {
            state.metrics.session_display_name_invalid();
        } else {
            state.metrics.session_request_invalid();
        }
        err
    })?;
    if let Some(name) = display_name.as_deref() {
        if !state.sim.lock().await.is_player_name_available(name, None) {
            state.metrics.session_display_name_conflict();
            return Err(player_name_response(PlayerNameError::Taken));
        }
    }

    let ticket = state
        .sessions
        .lock()
        .await
        .issue_with_display_name_and_account(display_name, account_subject)
        .map_err(|err| {
            match err {
                SessionIssueError::CapacityReached => {
                    state.metrics.session_ticket_capacity_rejected();
                }
                SessionIssueError::DisplayNameReserved => {
                    state.metrics.session_display_name_conflict();
                }
            }
            session_issue_response(err)
        })?;
    state.metrics.session_ticket_issued();

    Ok(Json(SessionTicketResponse {
        session_token: ticket.token,
        session_id: ticket.session_id,
        display_name: ticket.display_name,
        account_subject: ticket.account_subject,
        expires_in_seconds: ticket.expires_in_seconds,
        require_session: state.session_config.require_session,
        require_account: state.account_auth.require_account,
    }))
}

async fn metrics(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    authorize_metrics(&state, &headers)?;

    let (tick, players) = {
        let sim = state.sim.lock().await;
        (sim.tick_count(), sim.player_count())
    };
    let settlement = state
        .settlement_ledger
        .lock()
        .await
        .snapshot(state.settlement_config.chain_enabled);
    let (journal_events, journal_retained_capacity, journal_last_sequence) = {
        let journal = state.journal.lock().await;
        (
            journal.retained_events(),
            journal.retained_capacity(),
            journal.last_sequence(),
        )
    };
    let settlement_outbox_events = state.settlement_outbox.lock().await.events_written();
    let (pending_session_tickets, session_ticket_capacity) = {
        let mut sessions = state.sessions.lock().await;
        (sessions.pending_count(), sessions.capacity())
    };
    let tracked_session_issue_clients = state.session_issue_limiter.lock().await.tracked_clients();
    let tracked_account_session_subjects = state
        .account_session_limiter
        .lock()
        .await
        .tracked_subjects();

    let mut metrics = state.metrics.render_prometheus();

    append_metric(
        &mut metrics,
        "sundermere_tick",
        "Authoritative simulation tick.",
        "gauge",
        tick,
    );
    append_metric(
        &mut metrics,
        "sundermere_tick_budget_us",
        "Configured authoritative simulation tick work budget in microseconds.",
        "gauge",
        SERVER_TICK_BUDGET.as_micros() as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_players",
        "Players currently present in the simulation.",
        "gauge",
        players as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_journal_events",
        "In-memory journal events retained for admin inspection.",
        "gauge",
        journal_events as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_journal_retained_capacity",
        "Maximum in-memory journal events retained for admin inspection.",
        "gauge",
        journal_retained_capacity as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_journal_replayed_total_events",
        "Journal events found in the durable JSONL file at startup.",
        "gauge",
        state.journal_replayed_total_events as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_journal_last_sequence",
        "Last journal sequence value seen after replayed and recorded events.",
        "gauge",
        journal_last_sequence,
    );
    append_metric(
        &mut metrics,
        "sundermere_journal_sequence_anomalies",
        "Non-increasing journal sequence observations found during startup replay.",
        "gauge",
        state.journal_sequence_anomalies as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_max_journal_bytes",
        "Configured maximum durable journal file bytes accepted at startup.",
        "gauge",
        state.max_journal_bytes,
    );
    append_metric(
        &mut metrics,
        "sundermere_settlement_pending_jobs",
        "Settlement jobs awaiting confirmation.",
        "gauge",
        settlement.pending_jobs as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_settlement_confirmed_jobs",
        "Recent confirmed settlement jobs retained by the ledger.",
        "gauge",
        settlement.confirmed_jobs as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_settlement_owned_assets",
        "Assets with confirmed ownership receipts.",
        "gauge",
        settlement.owned_assets as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_settlement_outbox_events",
        "Settlement outbox JSONL events written or replayed.",
        "gauge",
        settlement_outbox_events as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_settlement_queue_capacity",
        "Available in-process settlement queue slots.",
        "gauge",
        state.settlement_tx.capacity() as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_settlement_queue_max_capacity",
        "Configured in-process settlement queue slots.",
        "gauge",
        state.settlement_tx.max_capacity() as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_max_settlement_outbox_bytes",
        "Configured maximum durable settlement outbox file bytes accepted at startup.",
        "gauge",
        state.max_settlement_outbox_bytes,
    );
    append_metric(
        &mut metrics,
        "sundermere_max_durable_line_bytes",
        "Configured maximum JSONL line bytes accepted during durable replay.",
        "gauge",
        state.max_durable_line_bytes as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_durable_sync_writes",
        "Whether durable journal and settlement outbox appends call sync_data after flush.",
        "gauge",
        u64::from(state.durable_sync_writes),
    );
    append_metric(
        &mut metrics,
        "sundermere_content_objects",
        "World content objects loaded at startup.",
        "gauge",
        state.content_manifest.object_count as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_max_content_objects",
        "Configured maximum world content objects accepted at startup.",
        "gauge",
        state.max_content_objects as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_session_pending_tickets",
        "Pending WebSocket session tickets.",
        "gauge",
        pending_session_tickets as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_session_ticket_capacity",
        "Maximum pending WebSocket session tickets.",
        "gauge",
        session_ticket_capacity as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_session_issue_rate_limit_per_minute",
        "Configured session ticket issue rate limit per client IP.",
        "gauge",
        state
            .session_issue_rate_limit_config
            .requests_per_minute
            .into(),
    );
    append_metric(
        &mut metrics,
        "sundermere_session_issue_rate_limit_burst",
        "Configured session ticket issue burst capacity per client IP.",
        "gauge",
        state.session_issue_rate_limit_config.burst.into(),
    );
    append_metric(
        &mut metrics,
        "sundermere_session_issue_rate_limit_clients",
        "Client IP buckets currently tracked by the session issue rate limiter.",
        "gauge",
        tracked_session_issue_clients as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_session_issue_rate_limit_max_clients",
        "Configured maximum client IP buckets tracked by the session issue rate limiter.",
        "gauge",
        state.session_issue_rate_limit_config.max_clients as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_account_session_rate_limit_per_minute",
        "Configured session ticket issue rate limit per authenticated account subject.",
        "gauge",
        state
            .account_session_rate_limit_config
            .requests_per_minute
            .into(),
    );
    append_metric(
        &mut metrics,
        "sundermere_account_session_rate_limit_burst",
        "Configured session ticket issue burst capacity per authenticated account subject.",
        "gauge",
        state.account_session_rate_limit_config.burst.into(),
    );
    append_metric(
        &mut metrics,
        "sundermere_account_session_rate_limit_subjects",
        "Account subjects currently tracked by the session issue rate limiter.",
        "gauge",
        tracked_account_session_subjects as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_account_session_rate_limit_max_subjects",
        "Configured maximum account subjects tracked by the session issue rate limiter.",
        "gauge",
        state.account_session_rate_limit_config.max_clients as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_max_active_connections",
        "Configured active WebSocket connection capacity.",
        "gauge",
        state.max_active_connections as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_max_connections_per_ip",
        "Configured active WebSocket connection capacity for one peer IP.",
        "gauge",
        state.max_connections_per_ip as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_active_connection_ips",
        "Peer IPs with at least one active WebSocket connection.",
        "gauge",
        state.peer_connections.lock().await.active_ips() as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_ws_heartbeat_seconds",
        "Configured WebSocket heartbeat interval in seconds.",
        "gauge",
        state.websocket_config.heartbeat_interval.as_secs(),
    );
    append_metric(
        &mut metrics,
        "sundermere_snapshot_interval_ms",
        "Configured per-client WebSocket snapshot interval in milliseconds.",
        "gauge",
        state.websocket_config.snapshot_interval.as_millis() as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_interest_radius_units",
        "Configured WebSocket snapshot interest radius in world units.",
        "gauge",
        state.websocket_config.interest_radius.round() as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_max_snapshot_bytes",
        "Configured maximum serialized welcome or snapshot payload size in bytes.",
        "gauge",
        state.max_snapshot_bytes as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_max_admin_snapshot_bytes",
        "Configured maximum serialized full admin/debug snapshot response size in bytes.",
        "gauge",
        state.max_admin_snapshot_bytes as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_ws_idle_timeout_seconds",
        "Configured WebSocket idle timeout in seconds.",
        "gauge",
        state.websocket_config.idle_timeout.as_secs(),
    );
    append_metric(
        &mut metrics,
        "sundermere_ws_max_text_bytes",
        "Configured maximum WebSocket text frame size in bytes.",
        "gauge",
        state.ingress_config.max_text_bytes as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_ws_message_burst",
        "Configured per-WebSocket accepted message burst before rate limiting.",
        "gauge",
        state.ingress_config.message_burst.into(),
    );
    append_metric(
        &mut metrics,
        "sundermere_ws_message_refill_per_second",
        "Configured per-WebSocket accepted message token refill rate per second.",
        "gauge",
        state.ingress_config.message_refill_per_second.into(),
    );
    append_metric(
        &mut metrics,
        "sundermere_client_reject_limit",
        "Rejected client message count that closes one WebSocket connection.",
        "gauge",
        state.client_reject_limit as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_origin_allowlist_enabled",
        "Whether HTTP Origin checks are enforced for session issuance and WebSocket upgrades.",
        "gauge",
        u64::from(state.origin_allowlist.enabled()),
    );
    append_metric(
        &mut metrics,
        "sundermere_origin_allowed_origins",
        "Configured count of exact-match allowed Origins.",
        "gauge",
        state.origin_allowlist.allowed_count() as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_public_deployment",
        "Whether public deployment startup guardrails were required.",
        "gauge",
        u64::from(state.public_deployment),
    );
    append_metric(
        &mut metrics,
        "sundermere_draining",
        "Whether this shard is refusing new session admission for drain or rollback.",
        "gauge",
        u64::from(state.draining),
    );
    append_metric(
        &mut metrics,
        "sundermere_require_session",
        "Whether WebSocket session tickets are required.",
        "gauge",
        u64::from(state.session_config.require_session),
    );
    append_metric(
        &mut metrics,
        "sundermere_require_account",
        "Whether account authentication is required before session tickets are issued.",
        "gauge",
        u64::from(state.account_auth.require_account),
    );
    append_metric(
        &mut metrics,
        "sundermere_dev_account_token_configured",
        "Whether the temporary development account bearer token is configured.",
        "gauge",
        u64::from(state.account_auth.dev_account_token_configured()),
    );
    append_metric(
        &mut metrics,
        "sundermere_account_auth_mode_dev_token",
        "Whether account authentication uses the temporary development bearer token mode.",
        "gauge",
        u64::from(state.account_auth.mode_name() == "dev-token"),
    );
    append_metric(
        &mut metrics,
        "sundermere_account_auth_mode_jwt_hs256",
        "Whether account authentication validates HS256 JWT bearer tokens.",
        "gauge",
        u64::from(state.account_auth.mode_name() == "jwt-hs256"),
    );
    append_metric(
        &mut metrics,
        "sundermere_account_jwt_issuer_configured",
        "Whether account JWT issuer validation is configured.",
        "gauge",
        u64::from(state.account_auth.jwt_issuer_configured()),
    );
    append_metric(
        &mut metrics,
        "sundermere_account_jwt_audience_configured",
        "Whether account JWT audience validation is configured.",
        "gauge",
        u64::from(state.account_auth.jwt_audience_configured()),
    );
    append_metric(
        &mut metrics,
        "sundermere_chain_enabled",
        "Whether chain settlement mode is enabled.",
        "gauge",
        u64::from(state.settlement_config.chain_enabled),
    );
    append_metric(
        &mut metrics,
        "sundermere_http_body_limit_bytes",
        "Configured maximum HTTP request body size in bytes.",
        "gauge",
        state.http_body_limit_bytes as u64,
    );
    append_metric(
        &mut metrics,
        "sundermere_admin_event_limit_cap",
        "Configured maximum events returned by one admin events query.",
        "gauge",
        state.admin_event_limit_cap as u64,
    );

    Ok((
        [(
            axum::http::header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        metrics,
    ))
}

fn append_metric(output: &mut String, name: &str, help: &str, metric_type: &str, value: u64) {
    use std::fmt::Write as _;

    let _ = writeln!(output, "# HELP {name} {help}");
    let _ = writeln!(output, "# TYPE {name} {metric_type}");
    let _ = writeln!(output, "{name} {value}");
}

#[derive(Debug, serde::Deserialize)]
struct EventQuery {
    limit: Option<usize>,
    after: Option<u64>,
}

async fn admin_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<EventQuery>,
) -> Result<Json<Vec<JournalEvent>>, (StatusCode, String)> {
    authorize_admin(&state, &headers)?;
    let requested_limit = query.limit.unwrap_or(DEFAULT_ADMIN_EVENT_LIMIT);
    let limit = requested_limit.min(state.admin_event_limit_cap);
    let events = {
        let journal = state.journal.lock().await;
        match query.after {
            Some(sequence) => journal.after(sequence, limit),
            None => journal.recent(limit),
        }
    };
    Ok(Json(events))
}

async fn admin_ownership(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<protocol::SettlementReceiptSnapshot>>, (StatusCode, String)> {
    authorize_admin(&state, &headers)?;
    Ok(Json(state.settlement_ledger.lock().await.ownership()))
}

async fn admin_runtime(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<RuntimeManifest>, (StatusCode, String)> {
    authorize_admin(&state, &headers)?;
    Ok(Json(state.runtime_manifest.clone()))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminSummary {
    tick: u64,
    players: usize,
    journal_events: usize,
    journal_retained_capacity: usize,
    journal_replayed_total_events: usize,
    journal_last_sequence: u64,
    journal_sequence_anomalies: usize,
    journal_path: String,
    max_journal_bytes: u64,
    max_content_objects: usize,
    settlement_pending: usize,
    settlement_confirmed: usize,
    settlement_owned_assets: usize,
    settlement_outbox_path: String,
    settlement_outbox_events: usize,
    settlement_queue_capacity: usize,
    settlement_queue_max_capacity: usize,
    settlement_queue_full_events: u64,
    settlement_queue_closed_events: u64,
    max_settlement_outbox_bytes: u64,
    max_durable_line_bytes: usize,
    durable_sync_writes: bool,
    durable_journal_persist_failures: u64,
    durable_settlement_persist_failures: u64,
    chain_enabled: bool,
    active_connections: u64,
    max_active_connections: usize,
    max_connections_per_ip: usize,
    active_connection_ips: usize,
    tick_budget_us: u64,
    snapshot_interval_ms: u64,
    interest_radius_units: f32,
    max_snapshot_bytes: usize,
    max_admin_snapshot_bytes: usize,
    websocket_heartbeat_seconds: u64,
    websocket_idle_timeout_seconds: u64,
    websocket_max_text_bytes: usize,
    websocket_message_burst: u32,
    websocket_message_refill_per_second: u32,
    client_reject_limit: usize,
    origin_allowlist_enabled: bool,
    origin_allowed_count: usize,
    public_deployment: bool,
    draining: bool,
    require_session: bool,
    require_account: bool,
    account_auth_mode: &'static str,
    dev_account_token_configured: bool,
    account_jwt_issuer_configured: bool,
    account_jwt_audience_configured: bool,
    session_pending_tickets: usize,
    session_ticket_capacity: usize,
    session_issue_rate_limit_per_minute: u32,
    session_issue_rate_limit_burst: u32,
    session_issue_rate_limit_clients: usize,
    session_issue_rate_limit_max_clients: usize,
    account_session_rate_limit_per_minute: u32,
    account_session_rate_limit_burst: u32,
    account_session_rate_limit_subjects: usize,
    account_session_rate_limit_max_subjects: usize,
    http_body_limit_bytes: usize,
    admin_event_limit_cap: usize,
    content: ContentManifest,
}

async fn admin_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AdminSummary>, (StatusCode, String)> {
    authorize_admin(&state, &headers)?;
    let sim = state.sim.lock().await;
    let settlement = state
        .settlement_ledger
        .lock()
        .await
        .snapshot(state.settlement_config.chain_enabled);
    let (journal_events, journal_retained_capacity, journal_last_sequence) = {
        let journal = state.journal.lock().await;
        (
            journal.retained_events(),
            journal.retained_capacity(),
            journal.last_sequence(),
        )
    };
    let journal_path = state
        .journal_writer
        .lock()
        .await
        .path()
        .display()
        .to_string();
    let (settlement_outbox_path, settlement_outbox_events) = {
        let outbox = state.settlement_outbox.lock().await;
        (outbox.path().display().to_string(), outbox.events_written())
    };
    let (session_pending_tickets, session_ticket_capacity) = {
        let mut sessions = state.sessions.lock().await;
        (sessions.pending_count(), sessions.capacity())
    };
    let session_issue_rate_limit_clients =
        state.session_issue_limiter.lock().await.tracked_clients();
    let account_session_rate_limit_subjects = state
        .account_session_limiter
        .lock()
        .await
        .tracked_subjects();
    let active_connection_ips = state.peer_connections.lock().await.active_ips();

    Ok(Json(AdminSummary {
        tick: sim.tick_count(),
        players: sim.player_count(),
        journal_events,
        journal_retained_capacity,
        journal_replayed_total_events: state.journal_replayed_total_events,
        journal_last_sequence,
        journal_sequence_anomalies: state.journal_sequence_anomalies,
        journal_path,
        max_journal_bytes: state.max_journal_bytes,
        max_content_objects: state.max_content_objects,
        settlement_pending: settlement.pending_jobs,
        settlement_confirmed: settlement.confirmed_jobs,
        settlement_owned_assets: settlement.owned_assets,
        settlement_outbox_path,
        settlement_outbox_events,
        settlement_queue_capacity: state.settlement_tx.capacity(),
        settlement_queue_max_capacity: state.settlement_tx.max_capacity(),
        settlement_queue_full_events: state.metrics.settlement_queue_full_total(),
        settlement_queue_closed_events: state.metrics.settlement_queue_closed_total(),
        max_settlement_outbox_bytes: state.max_settlement_outbox_bytes,
        max_durable_line_bytes: state.max_durable_line_bytes,
        durable_sync_writes: state.durable_sync_writes,
        durable_journal_persist_failures: state.metrics.durable_journal_persist_failed_total(),
        durable_settlement_persist_failures: state
            .metrics
            .durable_settlement_persist_failed_total(),
        chain_enabled: state.settlement_config.chain_enabled,
        active_connections: state.metrics.active_connections(),
        max_active_connections: state.max_active_connections,
        max_connections_per_ip: state.max_connections_per_ip,
        active_connection_ips,
        tick_budget_us: SERVER_TICK_BUDGET.as_micros() as u64,
        snapshot_interval_ms: state.websocket_config.snapshot_interval.as_millis() as u64,
        interest_radius_units: state.websocket_config.interest_radius,
        max_snapshot_bytes: state.max_snapshot_bytes,
        max_admin_snapshot_bytes: state.max_admin_snapshot_bytes,
        websocket_heartbeat_seconds: state.websocket_config.heartbeat_interval.as_secs(),
        websocket_idle_timeout_seconds: state.websocket_config.idle_timeout.as_secs(),
        websocket_max_text_bytes: state.ingress_config.max_text_bytes,
        websocket_message_burst: state.ingress_config.message_burst,
        websocket_message_refill_per_second: state.ingress_config.message_refill_per_second,
        client_reject_limit: state.client_reject_limit,
        origin_allowlist_enabled: state.origin_allowlist.enabled(),
        origin_allowed_count: state.origin_allowlist.allowed_count(),
        public_deployment: state.public_deployment,
        draining: state.draining,
        require_session: state.session_config.require_session,
        require_account: state.account_auth.require_account,
        account_auth_mode: state.account_auth.mode_name(),
        dev_account_token_configured: state.account_auth.dev_account_token_configured(),
        account_jwt_issuer_configured: state.account_auth.jwt_issuer_configured(),
        account_jwt_audience_configured: state.account_auth.jwt_audience_configured(),
        session_pending_tickets,
        session_ticket_capacity,
        session_issue_rate_limit_per_minute: state
            .session_issue_rate_limit_config
            .requests_per_minute,
        session_issue_rate_limit_burst: state.session_issue_rate_limit_config.burst,
        session_issue_rate_limit_clients,
        session_issue_rate_limit_max_clients: state.session_issue_rate_limit_config.max_clients,
        account_session_rate_limit_per_minute: state
            .account_session_rate_limit_config
            .requests_per_minute,
        account_session_rate_limit_burst: state.account_session_rate_limit_config.burst,
        account_session_rate_limit_subjects,
        account_session_rate_limit_max_subjects: state
            .account_session_rate_limit_config
            .max_clients,
        http_body_limit_bytes: state.http_body_limit_bytes,
        admin_event_limit_cap: state.admin_event_limit_cap,
        content: state.content_manifest.clone(),
    }))
}

async fn add_http_hardening_headers(request: Request<Body>, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let request_id = request_id_header_value(request.headers());
    let mut response = next.run(request).await;
    let headers = response.headers_mut();

    headers.insert(HeaderName::from_static("x-request-id"), request_id);
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    headers.insert(
        HeaderName::from_static("cross-origin-resource-policy"),
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static(CONTENT_SECURITY_POLICY),
    );

    let cache_control = if path.starts_with("/assets/") {
        "public, max-age=60"
    } else {
        "no-store"
    };
    headers.insert(CACHE_CONTROL, HeaderValue::from_static(cache_control));

    response
}

fn request_id_header_value(headers: &HeaderMap) -> HeaderValue {
    if let Some(value) = headers
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| is_safe_request_id(value))
    {
        return HeaderValue::from_str(value).expect("validated request id is a header value");
    }

    HeaderValue::from_str(&Uuid::new_v4().to_string()).expect("uuid is a header value")
}

fn is_safe_request_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn sanitized_trace_path(uri: &axum::http::Uri) -> &str {
    let path = uri.path();
    if path.is_empty() {
        "/"
    } else {
        path
    }
}

#[derive(Debug, serde::Deserialize)]
struct WsQuery {
    session: Option<String>,
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    State(state): State<AppState>,
    Query(query): Query<WsQuery>,
) -> Response {
    if let Err(err) = authorize_origin(&state, &headers) {
        return err.into_response();
    }

    if state.draining {
        state.metrics.session_draining_rejected();
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "shard is draining and refusing new sessions".to_string(),
        )
            .into_response();
    }

    if let Err(reason) = state.sessions.lock().await.preflight_validate(
        query.session.as_deref(),
        state.session_config.require_session,
    ) {
        state.metrics.session_ticket_rejected();
        return session_reject_response(reason).into_response();
    }

    let Ok(connection_permit) = state.connection_permits.clone().try_acquire_owned() else {
        state.metrics.ws_capacity_rejected();
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "server connection capacity reached".to_string(),
        )
            .into_response();
    };

    let peer_ip = addr.ip();
    let Some(peer_permit) = PeerConnectionPermit::try_acquire(&state, peer_ip).await else {
        state.metrics.ws_peer_capacity_rejected();
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "server peer connection capacity reached".to_string(),
        )
            .into_response();
    };

    let auth = match state.sessions.lock().await.validate(
        query.session.as_deref(),
        state.session_config.require_session,
    ) {
        Ok(auth) => auth,
        Err(reason) => {
            peer_permit.release().await;
            state.metrics.session_ticket_rejected();
            return session_reject_response(reason).into_response();
        }
    };
    let player_id = player_id_for_auth(&auth);
    let display_name = display_name_for_auth(&auth);
    let account_subject = account_subject_for_auth(&auth);

    ws.on_upgrade(move |socket| {
        player_socket(
            socket,
            state,
            connection_permit,
            peer_permit,
            player_id,
            display_name,
            account_subject,
        )
    })
    .into_response()
}

async fn player_socket(
    mut socket: WebSocket,
    state: AppState,
    _connection_permit: OwnedSemaphorePermit,
    peer_permit: PeerConnectionPermit,
    player_id: PlayerId,
    display_name: Option<String>,
    account_subject: Option<String>,
) {
    state.metrics.connection_opened();
    {
        let mut sim = state.sim.lock().await;
        if let Err(err) =
            sim.add_player_with_identity(player_id, display_name, account_subject.clone())
        {
            state.metrics.message_rejected();
            record_journal(
                &state,
                sim.tick_count(),
                JournalEventKind::ClientMessageRejected {
                    player_id,
                    reason: err.as_log_reason(),
                },
            )
            .await;
            let _ = socket.send(Message::Close(None)).await;
            state.metrics.connection_closed();
            peer_permit.release().await;
            return;
        }
        record_journal(
            &state,
            sim.tick_count(),
            JournalEventKind::PlayerJoined {
                player_id,
                account_subject,
            },
        )
        .await;
    }

    if let Err(err) = send_welcome(&mut socket, &state, player_id).await {
        state.metrics.send_error();
        error!(%err, "failed to send welcome");
        remove_player(&state, player_id).await;
        state.metrics.connection_closed();
        peer_permit.release().await;
        return;
    }

    let mut send_interval = tokio::time::interval(state.websocket_config.snapshot_interval);
    let mut heartbeat_interval = tokio::time::interval(state.websocket_config.heartbeat_interval);
    let mut idle_check_interval = tokio::time::interval(Duration::from_millis(250));
    let mut last_client_seen = Instant::now();
    let mut ingress = ClientIngress::new(state.ingress_config.clone());
    let mut rejected_messages = 0usize;
    loop {
        tokio::select! {
            _ = send_interval.tick() => {
                if let Err(err) = send_snapshot(&mut socket, &state, player_id).await {
                    state.metrics.send_error();
                    error!(%err, "websocket send failed");
                    break;
                }
            }
            _ = heartbeat_interval.tick() => {
                if let Err(err) = socket.send(Message::Ping(Vec::new())).await {
                    state.metrics.send_error();
                    error!(%err, "websocket heartbeat failed");
                    break;
                }
                state.metrics.heartbeat_ping();
            }
            _ = idle_check_interval.tick() => {
                if last_client_seen.elapsed() >= state.websocket_config.idle_timeout {
                    state.metrics.idle_timeout();
                    error!(
                        player_id = %player_id,
                        idle_timeout_seconds = state.websocket_config.idle_timeout.as_secs(),
                        "websocket idle timeout"
                    );
                    break;
                }
            }
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        last_client_seen = Instant::now();
                        if handle_client_text(&state, player_id, &text, &mut ingress).await {
                            rejected_messages += 1;
                            if rejected_messages >= state.client_reject_limit {
                                error!(
                                    player_id = %player_id,
                                    rejected_messages,
                                    reject_limit = state.client_reject_limit,
                                    "websocket client reject limit exceeded"
                                );
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(payload))) => {
                        last_client_seen = Instant::now();
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            state.metrics.send_error();
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {
                        last_client_seen = Instant::now();
                    }
                    Some(Ok(Message::Binary(payload))) => {
                        let reason = ingress.reject_binary_frame(payload.len());
                        record_rejection(&state, player_id, reason).await;
                        break;
                    }
                    Some(Err(err)) => {
                        error!(%err, "websocket receive failed");
                        break;
                    }
                }
            }
        }
    }

    remove_player(&state, player_id).await;
    state.metrics.connection_closed();
    peer_permit.release().await;
}

async fn send_welcome(
    socket: &mut WebSocket,
    state: &AppState,
    player_id: PlayerId,
) -> anyhow::Result<()> {
    let settlement = state
        .settlement_ledger
        .lock()
        .await
        .snapshot(state.settlement_config.chain_enabled);
    let snapshot = state.sim.lock().await.snapshot_for_player(
        player_id,
        settlement,
        state.websocket_config.interest_radius,
    );
    let message = ServerMessage::Welcome {
        player_id,
        snapshot,
    };
    let text = serde_json::to_string(&message)?;
    record_snapshot_visibility(state, &message);
    ensure_snapshot_payload_size(state, text.len())?;
    state.metrics.message_out(text.len());
    socket.send(Message::Text(text)).await?;
    Ok(())
}

async fn send_snapshot(
    socket: &mut WebSocket,
    state: &AppState,
    player_id: PlayerId,
) -> anyhow::Result<()> {
    let settlement = state
        .settlement_ledger
        .lock()
        .await
        .snapshot(state.settlement_config.chain_enabled);
    let snapshot = state.sim.lock().await.snapshot_for_player(
        player_id,
        settlement,
        state.websocket_config.interest_radius,
    );
    let visible_players = snapshot.players.len();
    let visible_objects = snapshot.objects.len();
    let message = ServerMessage::Snapshot(snapshot);
    let text = serde_json::to_string(&message)?;
    state
        .metrics
        .snapshot_visibility_observed(visible_players, visible_objects);
    ensure_snapshot_payload_size(state, text.len())?;
    state.metrics.snapshot_out(text.len());
    socket.send(Message::Text(text)).await?;
    Ok(())
}

fn record_snapshot_visibility(state: &AppState, message: &ServerMessage) {
    let snapshot = match message {
        ServerMessage::Welcome { snapshot, .. } | ServerMessage::Snapshot(snapshot) => snapshot,
        ServerMessage::Notice { .. } => return,
    };
    state
        .metrics
        .snapshot_visibility_observed(snapshot.players.len(), snapshot.objects.len());
}

fn ensure_snapshot_payload_size(state: &AppState, bytes: usize) -> anyhow::Result<()> {
    if bytes <= state.max_snapshot_bytes {
        return Ok(());
    }

    state.metrics.snapshot_payload_rejected();
    Err(anyhow!(
        "serialized snapshot payload exceeded MAX_SNAPSHOT_BYTES: bytes={} max={}",
        bytes,
        state.max_snapshot_bytes
    ))
}

async fn handle_client_text(
    state: &AppState,
    player_id: PlayerId,
    text: &str,
    ingress: &mut ClientIngress,
) -> bool {
    if let Err(reason) = ingress.allow_text_frame(text.len()) {
        record_rejection(state, player_id, reason).await;
        return true;
    }
    state.metrics.message_in();

    match serde_json::from_str::<ClientMessage>(text) {
        Ok(ClientMessage::Input {
            seq,
            up,
            down,
            left,
            right,
            interact,
        }) => {
            if let Err(reason) = ingress.accept_input_sequence(seq) {
                record_rejection(state, player_id, reason).await;
                return true;
            }

            state.sim.lock().await.set_input(
                player_id,
                PlayerInput {
                    up,
                    down,
                    left,
                    right,
                    interact,
                },
            );
            false
        }
        Ok(ClientMessage::Rename { name }) => {
            let mut sim = state.sim.lock().await;
            match sim.rename_player(player_id, &name) {
                Ok(Some(name)) => {
                    record_journal(
                        state,
                        sim.tick_count(),
                        JournalEventKind::PlayerRenamed { player_id, name },
                    )
                    .await;
                    false
                }
                Ok(None) => false,
                Err(err) => {
                    state.metrics.message_rejected();
                    record_journal(
                        state,
                        sim.tick_count(),
                        JournalEventKind::ClientMessageRejected {
                            player_id,
                            reason: err.as_log_reason(),
                        },
                    )
                    .await;
                    true
                }
            }
        }
        Err(err) => {
            state.metrics.message_rejected();
            let tick = state.sim.lock().await.tick_count();
            record_journal(
                state,
                tick,
                JournalEventKind::BadClientMessage {
                    player_id,
                    error: err.to_string(),
                },
            )
            .await;
            error!(%err, "bad client message");
            true
        }
    }
}

async fn record_rejection(state: &AppState, player_id: PlayerId, reason: IngressRejectReason) {
    state.metrics.message_rejected();
    let tick = state.sim.lock().await.tick_count();
    record_journal(
        state,
        tick,
        JournalEventKind::ClientMessageRejected {
            player_id,
            reason: reason.as_log_reason(),
        },
    )
    .await;
}

async fn run_tick_loop(state: AppState) {
    let mut interval = tokio::time::interval(SERVER_TICK_BUDGET);
    loop {
        interval.tick().await;
        let started_at = Instant::now();
        let (tick, outcome) = {
            let mut sim = state.sim.lock().await;
            let outcome = sim.tick(0.05);
            (sim.tick_count(), outcome)
        };
        for event in outcome.resource_events {
            record_journal(
                &state,
                tick,
                JournalEventKind::ResourceGathered {
                    player_id: event.player_id,
                    object_id: event.object_id,
                    resource: event.resource,
                    amount: event.amount,
                    total: event.total,
                },
            )
            .await;
        }
        for event in outcome.crafting_events {
            record_journal(
                &state,
                tick,
                JournalEventKind::ItemCrafted {
                    player_id: event.player_id,
                    object_id: event.object_id,
                    item_id: event.item_id,
                    amount: event.amount,
                    total: event.total,
                },
            )
            .await;
        }
        for job in outcome.settlement_jobs {
            let journal_job = job.clone();
            match settlement::enqueue_persisted_job(
                job,
                &state.settlement_tx,
                &state.settlement_ledger,
                &state.settlement_outbox,
                &state.metrics,
            )
            .await
            {
                Ok(()) => {
                    record_journal(
                        &state,
                        tick,
                        JournalEventKind::OwnershipClaimed {
                            job_id: journal_job.job_id,
                            player_id: journal_job.player_id,
                            account_subject: journal_job.account_subject,
                            asset_id: journal_job.asset_id,
                            reason: journal_job.reason,
                        },
                    )
                    .await;
                }
                Err(err) => {
                    error!(%err, job_id = %journal_job.job_id, "failed to persist or queue settlement job");
                    record_journal(
                        &state,
                        tick,
                        JournalEventKind::SettlementPersistenceFailed {
                            job_id: journal_job.job_id,
                            player_id: journal_job.player_id,
                            account_subject: journal_job.account_subject,
                            asset_id: journal_job.asset_id,
                            error: err.to_string(),
                        },
                    )
                    .await;
                }
            }
        }
        let duration = started_at.elapsed();
        state.metrics.tick_observed(
            duration.as_micros().min(u128::from(u64::MAX)) as u64,
            duration > SERVER_TICK_BUDGET,
        );
    }
}

async fn remove_player(state: &AppState, player_id: PlayerId) {
    let mut sim = state.sim.lock().await;
    sim.remove_player(player_id);
    record_journal(
        state,
        sim.tick_count(),
        JournalEventKind::PlayerLeft { player_id },
    )
    .await;
}

async fn record_journal(state: &AppState, tick: u64, kind: JournalEventKind) {
    let event = state.journal.lock().await.record(tick, kind);
    if let Err(err) = state.journal_writer.lock().await.append(&event) {
        state.metrics.durable_journal_persist_failed();
        error!(%err, "failed to persist journal event");
    }
}

fn authorize_admin(state: &AppState, headers: &HeaderMap) -> Result<(), (StatusCode, String)> {
    if let Some(expected) = &state.admin_token {
        let provided = bounded_header_str(headers, "x-admin-token");
        if !provided.is_some_and(|provided| constant_time_eq(provided, expected)) {
            state.metrics.admin_auth_rejected();
            return Err((StatusCode::UNAUTHORIZED, "invalid admin token".to_string()));
        }
    }
    Ok(())
}

fn authorize_metrics(state: &AppState, headers: &HeaderMap) -> Result<(), (StatusCode, String)> {
    if let Some(expected) = &state.metrics_token {
        let provided = bounded_header_str(headers, "x-metrics-token");
        if !provided.is_some_and(|provided| constant_time_eq(provided, expected)) {
            state.metrics.metrics_auth_rejected();
            return Err((
                StatusCode::UNAUTHORIZED,
                "invalid metrics token".to_string(),
            ));
        }
    }
    Ok(())
}

fn authorize_account_session_issue(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<Option<String>, (StatusCode, String)> {
    if !state.account_auth.require_account {
        return Ok(None);
    }

    let provided = bounded_bearer_token(headers);

    let authorized = match (&state.account_auth.mode, provided) {
        (AccountAuthMode::DevToken { token }, Some(provided)) => {
            constant_time_eq(provided, token).then_some(None)
        }
        (
            AccountAuthMode::JwtHs256 {
                secret,
                issuer,
                audience,
            },
            Some(provided),
        ) => validate_account_jwt(provided, secret, issuer.as_deref(), audience.as_deref())
            .map(Some)
            .ok(),
        _ => None,
    };

    if let Some(account_subject) = authorized {
        Ok(account_subject)
    } else {
        state.metrics.account_auth_rejected();
        Err((
            StatusCode::UNAUTHORIZED,
            "invalid account token".to_string(),
        ))
    }
}

fn bounded_header_str<'a>(headers: &'a HeaderMap, name: &'static str) -> Option<&'a str> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.len() <= MAX_AUTH_TOKEN_BYTES)
}

fn bounded_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|token| token.len() <= MAX_AUTH_TOKEN_BYTES)
}

#[derive(Debug, Deserialize)]
struct AccountJwtClaims {
    sub: String,
    exp: u64,
}

fn validate_account_jwt(
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

fn validate_account_subject(subject: &str) -> anyhow::Result<()> {
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

fn constant_time_eq(provided: &str, expected: &str) -> bool {
    let provided = provided.as_bytes();
    let expected = expected.as_bytes();
    let mut diff = provided.len() ^ expected.len();
    let max_len = provided.len().max(expected.len());
    for index in 0..max_len {
        let left = provided.get(index).copied().unwrap_or(0);
        let right = expected.get(index).copied().unwrap_or(0);
        diff |= usize::from(left ^ right);
    }
    diff == 0
}

fn authorize_origin(state: &AppState, headers: &HeaderMap) -> Result<(), (StatusCode, String)> {
    if !state.origin_allowlist.enabled() {
        return Ok(());
    }

    let Some(origin) = headers.get(ORIGIN).and_then(|value| value.to_str().ok()) else {
        state.metrics.origin_rejected();
        return Err((StatusCode::FORBIDDEN, "origin is not allowed".to_string()));
    };

    if state.origin_allowlist.allows(origin) {
        Ok(())
    } else {
        state.metrics.origin_rejected();
        Err((StatusCode::FORBIDDEN, "origin is not allowed".to_string()))
    }
}

fn session_issue_response(err: SessionIssueError) -> (StatusCode, String) {
    match err {
        SessionIssueError::CapacityReached => (
            StatusCode::SERVICE_UNAVAILABLE,
            "too many pending session tickets".to_string(),
        ),
        SessionIssueError::DisplayNameReserved => (
            StatusCode::CONFLICT,
            "invalid-player-name already-reserved".to_string(),
        ),
    }
}

fn session_reject_response(reason: SessionRejectReason) -> (StatusCode, String) {
    match reason {
        SessionRejectReason::Missing => (
            StatusCode::UNAUTHORIZED,
            "missing session ticket".to_string(),
        ),
        SessionRejectReason::Invalid => (
            StatusCode::UNAUTHORIZED,
            "invalid session ticket".to_string(),
        ),
        SessionRejectReason::Expired => (
            StatusCode::UNAUTHORIZED,
            "expired session ticket".to_string(),
        ),
    }
}

fn session_display_name_from_body(body: &[u8]) -> Result<Option<String>, (StatusCode, String)> {
    if body.iter().all(|byte| byte.is_ascii_whitespace()) {
        return Ok(None);
    }

    let request: SessionTicketRequest = serde_json::from_slice(body).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "invalid session request JSON".to_string(),
        )
    })?;
    match request.name {
        Some(name) => validate_player_name(&name)
            .map(Some)
            .map_err(player_name_response),
        None => Ok(None),
    }
}

fn player_name_response(err: PlayerNameError) -> (StatusCode, String) {
    let status = match &err {
        PlayerNameError::Taken => StatusCode::CONFLICT,
        PlayerNameError::Empty
        | PlayerNameError::TooLong { .. }
        | PlayerNameError::InvalidCharacters => StatusCode::BAD_REQUEST,
    };
    (status, err.as_log_reason())
}

fn player_id_for_auth(auth: &SessionAuth) -> PlayerId {
    match auth {
        SessionAuth::AnonymousDev => Uuid::new_v4(),
        SessionAuth::Ticket { session_id, .. } => *session_id,
    }
}

fn display_name_for_auth(auth: &SessionAuth) -> Option<String> {
    match auth {
        SessionAuth::AnonymousDev => None,
        SessionAuth::Ticket { display_name, .. } => display_name.clone(),
    }
}

fn account_subject_for_auth(auth: &SessionAuth) -> Option<String> {
    match auth {
        SessionAuth::AnonymousDev => None,
        SessionAuth::Ticket {
            account_subject, ..
        } => account_subject.clone(),
    }
}

fn session_config() -> anyhow::Result<SessionConfig> {
    let require_session = env_bool("REQUIRE_SESSION", false)?;
    let ticket_ttl = Duration::from_secs(env_positive_u64("SESSION_TICKET_TTL_SECONDS", 120)?);
    let ticket_capacity = env_positive_usize("SESSION_TICKET_CAPACITY", 2048)?;

    Ok(SessionConfig {
        require_session,
        ticket_ttl,
        ticket_capacity,
    })
}

fn session_issue_rate_limit_config() -> anyhow::Result<SessionIssueRateLimitConfig> {
    let requests_per_minute = env_positive_u32("SESSION_ISSUE_RATE_LIMIT_PER_MINUTE", 120)?;
    let burst = env_positive_u32("SESSION_ISSUE_RATE_LIMIT_BURST", 30)?;
    let max_clients = env_positive_usize(
        "SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS",
        DEFAULT_SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS,
    )?;

    Ok(SessionIssueRateLimitConfig {
        requests_per_minute,
        burst,
        max_clients,
    })
}

fn account_session_rate_limit_config() -> anyhow::Result<SessionIssueRateLimitConfig> {
    let requests_per_minute = env_positive_u32(
        "ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE",
        DEFAULT_ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE,
    )?;
    let burst = env_positive_u32(
        "ACCOUNT_SESSION_RATE_LIMIT_BURST",
        DEFAULT_ACCOUNT_SESSION_RATE_LIMIT_BURST,
    )?;
    let max_clients = env_positive_usize(
        "ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS",
        DEFAULT_ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS,
    )?;

    Ok(SessionIssueRateLimitConfig {
        requests_per_minute,
        burst,
        max_clients,
    })
}

#[derive(Debug, Clone)]
struct AccountAuthConfig {
    require_account: bool,
    mode: AccountAuthMode,
}

#[derive(Debug, Clone)]
enum AccountAuthMode {
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
    fn mode_name(&self) -> &'static str {
        match &self.mode {
            AccountAuthMode::Disabled => "disabled",
            AccountAuthMode::DevToken { .. } => "dev-token",
            AccountAuthMode::JwtHs256 { .. } => "jwt-hs256",
        }
    }

    fn dev_account_token_configured(&self) -> bool {
        matches!(self.mode, AccountAuthMode::DevToken { .. })
    }

    fn jwt_issuer_configured(&self) -> bool {
        matches!(
            self.mode,
            AccountAuthMode::JwtHs256 {
                issuer: Some(_),
                ..
            }
        )
    }

    fn jwt_audience_configured(&self) -> bool {
        matches!(
            self.mode,
            AccountAuthMode::JwtHs256 {
                audience: Some(_),
                ..
            }
        )
    }
}

fn account_auth_config() -> anyhow::Result<AccountAuthConfig> {
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

fn validate_public_deployment(
    public_deployment: bool,
    session_config: &SessionConfig,
    account_auth: &AccountAuthConfig,
    origin_allowlist: &OriginAllowlistConfig,
    admin_token: Option<&str>,
    metrics_token: Option<&str>,
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
            if issuer.is_none() {
                missing.push("ACCOUNT_JWT_ISSUER");
            }
            if audience.is_none() {
                missing.push("ACCOUNT_JWT_AUDIENCE");
            }
        }
    }
    if !origin_allowlist.enabled() {
        missing.push("ALLOWED_ORIGINS");
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

fn validate_bind_addr(public_deployment: bool, addr: SocketAddr) -> anyhow::Result<()> {
    if public_deployment || addr.ip().is_loopback() {
        return Ok(());
    }

    Err(anyhow!(
        "BIND_ADDR {} is not loopback; set PUBLIC_DEPLOYMENT=true and required public deployment guardrails before binding externally",
        addr
    ))
}

fn validate_chain_mode(public_deployment: bool, chain_enabled: bool) -> anyhow::Result<()> {
    if !public_deployment || !chain_enabled {
        return Ok(());
    }

    Err(anyhow!(
        "CHAIN_ENABLED=true is not supported with PUBLIC_DEPLOYMENT=true until signer and indexer configuration are implemented"
    ))
}

#[derive(Debug, Clone)]
struct WebSocketConfig {
    snapshot_interval: Duration,
    interest_radius: f32,
    heartbeat_interval: Duration,
    idle_timeout: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OriginAllowlistConfig {
    allowed: Vec<String>,
}

impl OriginAllowlistConfig {
    fn disabled() -> Self {
        Self {
            allowed: Vec::new(),
        }
    }

    fn enabled(&self) -> bool {
        !self.allowed.is_empty()
    }

    fn allowed_count(&self) -> usize {
        self.allowed.len()
    }

    fn allows(&self, origin: &str) -> bool {
        self.allowed.iter().any(|allowed| allowed == origin)
    }
}

#[derive(Debug, Default)]
struct PeerConnectionCounts {
    active_by_ip: HashMap<IpAddr, usize>,
}

impl PeerConnectionCounts {
    fn try_acquire(&mut self, ip: IpAddr, limit: usize) -> bool {
        let active = self.active_by_ip.entry(ip).or_insert(0);
        if *active >= limit {
            return false;
        }

        *active += 1;
        true
    }

    fn release(&mut self, ip: IpAddr) {
        if let Some(active) = self.active_by_ip.get_mut(&ip) {
            *active = active.saturating_sub(1);
            if *active == 0 {
                self.active_by_ip.remove(&ip);
            }
        }
    }

    fn active_ips(&self) -> usize {
        self.active_by_ip.len()
    }
}

#[derive(Debug)]
struct PeerConnectionPermit {
    connections: Arc<Mutex<PeerConnectionCounts>>,
    peer_ip: IpAddr,
    released: bool,
}

impl PeerConnectionPermit {
    async fn try_acquire(state: &AppState, peer_ip: IpAddr) -> Option<Self> {
        if !state
            .peer_connections
            .lock()
            .await
            .try_acquire(peer_ip, state.max_connections_per_ip)
        {
            return None;
        }

        Some(Self {
            connections: state.peer_connections.clone(),
            peer_ip,
            released: false,
        })
    }

    async fn release(mut self) {
        self.release_inner().await;
    }

    async fn release_inner(&mut self) {
        if self.released {
            return;
        }

        self.connections.lock().await.release(self.peer_ip);
        self.released = true;
    }
}

impl Drop for PeerConnectionPermit {
    fn drop(&mut self) {
        if self.released {
            return;
        }

        let connections = self.connections.clone();
        let peer_ip = self.peer_ip;
        self.released = true;
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                connections.lock().await.release(peer_ip);
            });
        }
    }
}

fn origin_allowlist_config() -> anyhow::Result<OriginAllowlistConfig> {
    match std::env::var("ALLOWED_ORIGINS") {
        Ok(value) => parse_origin_allowlist_value(&value),
        Err(std::env::VarError::NotPresent) => Ok(OriginAllowlistConfig::disabled()),
        Err(err) => Err(anyhow!("ALLOWED_ORIGINS is not readable: {err}")),
    }
}

fn parse_origin_allowlist_value(value: &str) -> anyhow::Result<OriginAllowlistConfig> {
    if value.trim().is_empty() {
        return Ok(OriginAllowlistConfig::disabled());
    }

    let origins: Vec<&str> = value
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .collect();

    if origins.is_empty() {
        return Err(anyhow!("ALLOWED_ORIGINS must include at least one origin"));
    }
    if origins.len() > MAX_ALLOWED_ORIGINS {
        return Err(anyhow!(
            "ALLOWED_ORIGINS must include at most {MAX_ALLOWED_ORIGINS} origins"
        ));
    }

    let mut allowed = Vec::new();
    for origin in origins {
        validate_allowed_origin(origin)?;
        if !allowed
            .iter()
            .any(|allowed_origin| allowed_origin == origin)
        {
            allowed.push(origin.to_string());
        }
    }

    Ok(OriginAllowlistConfig { allowed })
}

fn validate_allowed_origin(origin: &str) -> anyhow::Result<()> {
    if origin.len() > MAX_ORIGIN_BYTES {
        return Err(anyhow!(
            "ALLOWED_ORIGINS entries must be at most {MAX_ORIGIN_BYTES} bytes"
        ));
    }
    if origin
        .chars()
        .any(|character| character.is_ascii_whitespace() || character.is_control())
    {
        return Err(anyhow!(
            "ALLOWED_ORIGINS entries must not contain whitespace or control characters"
        ));
    }

    let host = if let Some(host) = origin.strip_prefix("http://") {
        host
    } else if let Some(host) = origin.strip_prefix("https://") {
        host
    } else {
        return Err(anyhow!(
            "ALLOWED_ORIGINS entries must be exact http:// or https:// origins"
        ));
    };

    if host.is_empty()
        || host
            .chars()
            .any(|character| matches!(character, '/' | '?' | '#'))
    {
        return Err(anyhow!(
            "ALLOWED_ORIGINS entries must be exact http:// or https:// origins without path, query, or fragment"
        ));
    }

    Ok(())
}

fn websocket_config() -> anyhow::Result<WebSocketConfig> {
    let snapshot_interval_ms = env_positive_u64("SNAPSHOT_INTERVAL_MS", 50)?;
    let interest_radius = env_positive_f32("INTEREST_RADIUS", INTEREST_RADIUS)?;
    let heartbeat_seconds = env_positive_u64("WS_HEARTBEAT_SECONDS", 30)?;
    let idle_timeout_seconds = env_positive_u64("WS_IDLE_TIMEOUT_SECONDS", 180)?;
    validate_websocket_timing(heartbeat_seconds, idle_timeout_seconds)?;

    Ok(WebSocketConfig {
        snapshot_interval: Duration::from_millis(snapshot_interval_ms),
        interest_radius,
        heartbeat_interval: Duration::from_secs(heartbeat_seconds),
        idle_timeout: Duration::from_secs(idle_timeout_seconds),
    })
}

fn client_ingress_config() -> anyhow::Result<ClientIngressConfig> {
    Ok(ClientIngressConfig {
        max_text_bytes: env_positive_usize("WS_MAX_TEXT_BYTES", DEFAULT_MAX_CLIENT_TEXT_BYTES)?,
        message_burst: env_positive_u32("WS_MESSAGE_BURST", DEFAULT_MESSAGE_BURST)?,
        message_refill_per_second: env_positive_u32(
            "WS_MESSAGE_REFILL_PER_SECOND",
            DEFAULT_MESSAGE_REFILL_PER_SECOND,
        )?,
    })
}

fn validate_websocket_timing(
    heartbeat_seconds: u64,
    idle_timeout_seconds: u64,
) -> anyhow::Result<()> {
    if idle_timeout_seconds <= heartbeat_seconds {
        return Err(anyhow!(
            "WS_IDLE_TIMEOUT_SECONDS must be greater than WS_HEARTBEAT_SECONDS"
        ));
    }
    Ok(())
}

fn env_bool(name: &str, default: bool) -> anyhow::Result<bool> {
    match std::env::var(name) {
        Ok(value) => parse_bool_value(name, &value),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(err) => Err(anyhow!("{name} is not readable: {err}")),
    }
}

fn env_positive_u64(name: &str, default: u64) -> anyhow::Result<u64> {
    match std::env::var(name) {
        Ok(value) => parse_positive_u64_value(name, &value),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(err) => Err(anyhow!("{name} is not readable: {err}")),
    }
}

fn env_positive_usize(name: &str, default: usize) -> anyhow::Result<usize> {
    match std::env::var(name) {
        Ok(value) => parse_positive_usize_value(name, &value),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(err) => Err(anyhow!("{name} is not readable: {err}")),
    }
}

fn env_positive_u32(name: &str, default: u32) -> anyhow::Result<u32> {
    match std::env::var(name) {
        Ok(value) => parse_positive_u32_value(name, &value),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(err) => Err(anyhow!("{name} is not readable: {err}")),
    }
}

fn env_positive_f32(name: &str, default: f32) -> anyhow::Result<f32> {
    match std::env::var(name) {
        Ok(value) => parse_positive_f32_value(name, &value),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(err) => Err(anyhow!("{name} is not readable: {err}")),
    }
}

fn env_optional_nonempty_string(name: &str) -> anyhow::Result<Option<String>> {
    match std::env::var(name) {
        Ok(value) if value.trim().is_empty() => Ok(None),
        Ok(value) => Ok(Some(value)),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(err) => Err(anyhow!("{name} is not readable: {err}")),
    }
}

fn bind_addr() -> anyhow::Result<SocketAddr> {
    std::env::var("BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:4107".to_string())
        .parse()
        .map_err(|err| anyhow!("BIND_ADDR must be a socket address: {err}"))
}

fn parse_bool_value(name: &str, value: &str) -> anyhow::Result<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => Err(anyhow!(
            "{name} must be a boolean value: true/false, 1/0, yes/no, or on/off"
        )),
    }
}

fn parse_positive_u64_value(name: &str, value: &str) -> anyhow::Result<u64> {
    let parsed = value
        .trim()
        .parse::<u64>()
        .map_err(|_| anyhow!("{name} must be a positive integer"))?;
    if parsed == 0 {
        return Err(anyhow!("{name} must be greater than zero"));
    }
    Ok(parsed)
}

fn parse_positive_usize_value(name: &str, value: &str) -> anyhow::Result<usize> {
    let parsed = value
        .trim()
        .parse::<usize>()
        .map_err(|_| anyhow!("{name} must be a positive integer"))?;
    if parsed == 0 {
        return Err(anyhow!("{name} must be greater than zero"));
    }
    Ok(parsed)
}

fn parse_positive_u32_value(name: &str, value: &str) -> anyhow::Result<u32> {
    let parsed = value
        .trim()
        .parse::<u32>()
        .map_err(|_| anyhow!("{name} must be a positive integer"))?;
    if parsed == 0 {
        return Err(anyhow!("{name} must be greater than zero"));
    }
    Ok(parsed)
}

fn parse_positive_f32_value(name: &str, value: &str) -> anyhow::Result<f32> {
    let parsed = value
        .trim()
        .parse::<f32>()
        .map_err(|_| anyhow!("{name} must be a positive number"))?;
    if !parsed.is_finite() || parsed <= 0.0 {
        return Err(anyhow!("{name} must be a finite number greater than zero"));
    }
    Ok(parsed)
}

fn client_dir() -> PathBuf {
    std::env::var("CLIENT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("server crate has workspace parent")
                .join("client")
        })
}

fn assets_dir() -> PathBuf {
    std::env::var("ASSETS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("server crate has workspace parent")
                .join("assets")
        })
}

fn content_path() -> PathBuf {
    std::env::var("CONTENT_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("data")
                .join("world.json")
        })
}

fn journal_path() -> PathBuf {
    std::env::var("JOURNAL_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("server crate has workspace parent")
                .join("var")
                .join("journal.jsonl")
        })
}

fn settlement_outbox_path() -> PathBuf {
    std::env::var("SETTLEMENT_OUTBOX_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("server crate has workspace parent")
                .join("var")
                .join("settlement-outbox.jsonl")
        })
}

#[allow(dead_code)]
fn status_notice(
    level: NoticeLevel,
    message: impl Into<String>,
) -> (StatusCode, Json<ServerMessage>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ServerMessage::Notice {
            level,
            message: message.into(),
        }),
    )
}

#[cfg(test)]
mod config_tests {
    use super::{
        bounded_bearer_token, bounded_header_str, constant_time_eq, durable_parent_status,
        durable_persistence_check, is_safe_request_id, parse_bool_value,
        parse_origin_allowlist_value, parse_positive_f32_value, parse_positive_u32_value,
        parse_positive_u64_value, parse_positive_usize_value, sanitized_trace_path,
        session_display_name_from_body, settlement_queue_capacity_check, validate_account_jwt,
        validate_account_subject, validate_bind_addr, validate_chain_mode,
        validate_public_deployment, validate_websocket_timing, AccountAuthConfig, AccountAuthMode,
        OriginAllowlistConfig, MAX_ACCOUNT_SUBJECT_BYTES, MAX_ALLOWED_ORIGINS,
        MAX_AUTH_TOKEN_BYTES, MAX_ORIGIN_BYTES,
    };
    use crate::metrics::AppMetrics;
    use crate::session::SessionConfig;
    use crate::settlement::{self, SettlementJob};
    use axum::http::{header::AUTHORIZATION, HeaderMap, HeaderValue, StatusCode};
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use uuid::Uuid;

    #[test]
    fn parses_boolean_env_values_strictly() {
        assert!(parse_bool_value("TEST_BOOL", "true").expect("true parses"));
        assert!(parse_bool_value("TEST_BOOL", "1").expect("1 parses"));
        assert!(!parse_bool_value("TEST_BOOL", "false").expect("false parses"));
        assert!(!parse_bool_value("TEST_BOOL", "0").expect("0 parses"));
        assert!(parse_bool_value("TEST_BOOL", "maybe").is_err());
    }

    #[test]
    fn rejects_invalid_positive_integer_env_values() {
        assert_eq!(
            parse_positive_u64_value("TEST_U64", "42").expect("u64 parses"),
            42
        );
        assert_eq!(
            parse_positive_usize_value("TEST_USIZE", "7").expect("usize parses"),
            7
        );
        assert_eq!(
            parse_positive_u32_value("TEST_U32", "3").expect("u32 parses"),
            3
        );
        assert_eq!(
            parse_positive_f32_value("TEST_F32", "3.5").expect("f32 parses"),
            3.5
        );
        assert!(parse_positive_u64_value("TEST_U64", "0").is_err());
        assert!(parse_positive_u64_value("TEST_U64", "abc").is_err());
        assert!(parse_positive_usize_value("TEST_USIZE", "0").is_err());
        assert!(parse_positive_usize_value("TEST_USIZE", "abc").is_err());
        assert!(parse_positive_u32_value("TEST_U32", "0").is_err());
        assert!(parse_positive_u32_value("TEST_U32", "abc").is_err());
        assert!(parse_positive_f32_value("TEST_F32", "0").is_err());
        assert!(parse_positive_f32_value("TEST_F32", "NaN").is_err());
        assert!(parse_positive_f32_value("TEST_F32", "inf").is_err());
        assert!(parse_positive_f32_value("TEST_F32", "abc").is_err());
    }

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
    fn durable_parent_status_accepts_existing_mutable_directory() {
        let path = std::env::temp_dir().join("sundermere-ready-test.jsonl");

        let status = durable_parent_status(&path);

        assert!(status.ok, "{}", status.detail);
        assert!(status.detail.contains("not read-only"));
    }

    #[test]
    fn durable_parent_status_rejects_non_directory_parent() {
        let parent_file = unique_temp_path("sundermere-ready-parent");
        fs::write(&parent_file, b"not a directory").expect("write parent marker");

        let status = durable_parent_status(&parent_file.join("journal.jsonl"));

        let _ = fs::remove_file(parent_file);
        assert!(!status.ok);
        assert!(
            status.detail.contains("not a directory") || status.detail.contains("not accessible"),
            "{}",
            status.detail
        );
    }

    #[test]
    fn durable_persistence_failures_make_readiness_unhealthy() {
        let metrics = AppMetrics::default();

        let healthy = durable_persistence_check(&metrics);
        assert!(healthy.ok);
        assert_eq!(healthy.name, "durablePersistenceHealthy");

        metrics.durable_journal_persist_failed();
        let journal_failed = durable_persistence_check(&metrics);
        assert!(!journal_failed.ok);
        assert!(journal_failed.detail.contains("1 journal persist failures"));
        assert!(journal_failed
            .detail
            .contains("0 settlement persist failures"));

        metrics.durable_settlement_persist_failed();
        let both_failed = durable_persistence_check(&metrics);
        assert!(!both_failed.ok);
        assert!(both_failed.detail.contains("1 journal persist failures"));
        assert!(both_failed.detail.contains("1 settlement persist failures"));
    }

    #[test]
    fn full_settlement_queue_makes_readiness_unhealthy() {
        let (tx, _rx) = settlement::channel_with_capacity(1);

        let healthy = settlement_queue_capacity_check(&tx);
        assert!(healthy.ok);
        assert_eq!(healthy.name, "settlementQueueCapacityAvailable");
        assert!(healthy.detail.contains("1/1 settlement queue slots"));

        tx.try_send(SettlementJob {
            job_id: Uuid::new_v4(),
            player_id: Uuid::new_v4(),
            account_subject: None,
            asset_id: "asset-ready-test".to_string(),
            reason: "test".to_string(),
        })
        .expect("queue fills");

        let full = settlement_queue_capacity_check(&tx);
        assert!(!full.ok);
        assert!(full.detail.contains("0/1 settlement queue slots"));
    }

    #[test]
    fn rejects_idle_timeout_not_greater_than_heartbeat() {
        assert!(validate_websocket_timing(30, 180).is_ok());
        assert!(validate_websocket_timing(30, 30).is_err());
        assert!(validate_websocket_timing(30, 29).is_err());
    }

    #[test]
    fn parses_origin_allowlist_values() {
        let config = parse_origin_allowlist_value(
            "https://game.example, http://localhost:4107, https://game.example",
        )
        .expect("origin allowlist parses");

        assert!(config.enabled());
        assert_eq!(config.allowed_count(), 2);
        assert!(config.allows("https://game.example"));
        assert!(config.allows("http://localhost:4107"));
        assert!(!config.allows("https://other.example"));
    }

    #[test]
    fn empty_origin_allowlist_disables_origin_checks() {
        let config = parse_origin_allowlist_value(" ").expect("empty allowlist parses");

        assert!(!config.enabled());
        assert_eq!(config.allowed_count(), 0);
    }

    #[test]
    fn rejects_non_origin_allowlist_entries() {
        assert!(parse_origin_allowlist_value("game.example").is_err());
        assert!(parse_origin_allowlist_value("ftp://game.example").is_err());
        assert!(parse_origin_allowlist_value("https://").is_err());
        assert!(parse_origin_allowlist_value("https://game.example/path").is_err());
        assert!(parse_origin_allowlist_value("https://game.example?debug=true").is_err());
        assert!(parse_origin_allowlist_value("https://game.example#fragment").is_err());
        assert!(
            parse_origin_allowlist_value(&format!("https://{}", "a".repeat(MAX_ORIGIN_BYTES)))
                .is_err()
        );
        assert!(parse_origin_allowlist_value(
            &(0..=MAX_ALLOWED_ORIGINS)
                .map(|index| format!("https://game-{index}.example"))
                .collect::<Vec<_>>()
                .join(","),
        )
        .is_err());
    }

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
        )
        .is_ok());

        let err = validate_public_deployment(
            true,
            &dev_sessions,
            &dev_account,
            &OriginAllowlistConfig::disabled(),
            None,
            None,
        )
        .expect_err("public deployment rejects local defaults");
        let message = err.to_string();
        assert!(message.contains("PUBLIC_DEPLOYMENT"));
        assert!(message.contains("REQUIRE_SESSION=true"));
        assert!(message.contains("REQUIRE_ACCOUNT=true"));
        assert!(message.contains("ACCOUNT_AUTH_MODE"));
        assert!(message.contains("ALLOWED_ORIGINS"));
        assert!(message.contains("ADMIN_TOKEN"));
        assert!(message.contains("METRICS_TOKEN"));

        assert!(validate_public_deployment(
            true,
            &strict_sessions,
            &strict_account,
            &origins,
            Some("admin-token-public-12345"),
            Some("metrics-token-public-123"),
        )
        .is_ok());

        assert!(validate_public_deployment(
            true,
            &strict_sessions,
            &strict_jwt_account,
            &origins,
            Some("admin-token-public-12345"),
            Some("metrics-token-public-123"),
        )
        .is_ok());

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
        )
        .expect_err("public deployment requires jwt issuer and audience");
        let jwt_message = jwt_missing_claims_err.to_string();
        assert!(jwt_message.contains("ACCOUNT_JWT_ISSUER"));
        assert!(jwt_message.contains("ACCOUNT_JWT_AUDIENCE"));
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

    fn unique_temp_path(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{}-{nonce}", std::process::id()))
    }
}
