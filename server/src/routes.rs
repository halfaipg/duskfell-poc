use std::path::PathBuf;

use axum::body::Body;
use axum::extract::DefaultBodyLimit;
use axum::http::Request;
use axum::middleware;
use axum::routing::{get, post};
use axum::Router;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing::debug_span;

use crate::admin_routes::{admin_events, admin_ownership, admin_runtime, admin_summary};
use crate::http_routes::{add_http_hardening_headers, sanitized_trace_path};
use crate::metrics_routes::{metrics, snapshot};
use crate::readiness::readyz;
use crate::session_routes::issue_session;
use crate::ws;
use crate::AppState;

pub(crate) fn build_router(state: AppState, assets_dir: PathBuf, client_dir: PathBuf) -> Router {
    let http_body_limit_bytes = state.http_body_limit_bytes;

    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/api/session", post(issue_session))
        .route("/api/snapshot", get(snapshot))
        .route("/metrics", get(metrics))
        .route("/admin/events", get(admin_events))
        .route("/admin/ownership", get(admin_ownership))
        .route("/admin/runtime", get(admin_runtime))
        .route("/admin/summary", get(admin_summary))
        .route("/ws", get(ws::ws_handler))
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
        .with_state(state)
}

async fn healthz() -> &'static str {
    "ok"
}
