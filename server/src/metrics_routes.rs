use axum::extract::State;
use axum::http::header::CONTENT_TYPE;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};

mod runtime_metrics;

use crate::auth::{authorize_admin, authorize_metrics};
use crate::AppState;

pub(crate) async fn snapshot(
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

pub(crate) async fn metrics(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    authorize_metrics(&state, &headers)?;
    let metrics = runtime_metrics::render_runtime_metrics(&state).await;

    Ok((
        [(CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")],
        metrics,
    ))
}
