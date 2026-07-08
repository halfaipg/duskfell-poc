use std::net::SocketAddr;

use axum::body::Bytes;
use axum::extract::{ConnectInfo, State};
use axum::http::header::CONTENT_TYPE;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::{authorize_account_session_issue, authorize_origin};
use crate::player_identity::{validate_player_name, PlayerNameError};
use crate::session::SessionIssueError;
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionTicketResponse {
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

pub(crate) async fn issue_session(
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
    session_body_content_type(&headers, &body).map_err(|err| {
        state.metrics.session_request_invalid();
        err
    })?;
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

pub(crate) fn session_display_name_from_body(
    body: &[u8],
) -> Result<Option<String>, (StatusCode, String)> {
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

pub(crate) fn session_body_content_type(
    headers: &HeaderMap,
    body: &[u8],
) -> Result<(), (StatusCode, String)> {
    if body.iter().all(|byte| byte.is_ascii_whitespace()) {
        return Ok(());
    }

    let Some(content_type) = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
    else {
        return Err(unsupported_session_media_type());
    };
    let media_type = content_type.split(';').next().unwrap_or("").trim();
    if media_type.eq_ignore_ascii_case("application/json") {
        Ok(())
    } else {
        Err(unsupported_session_media_type())
    }
}

fn unsupported_session_media_type() -> (StatusCode, String) {
    (
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "session request body must use Content-Type: application/json".to_string(),
    )
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
