use axum::http::header::{AUTHORIZATION, ORIGIN};
use axum::http::{HeaderMap, StatusCode};
use uuid::Uuid;

use crate::config::{validate_account_jwt, AccountAuthMode, MAX_AUTH_TOKEN_BYTES};
use crate::protocol::PlayerId;
use crate::session::{SessionAuth, SessionRejectReason};
use crate::AppState;

pub(crate) fn authorize_admin(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, String)> {
    if let Some(expected) = &state.admin_token {
        let provided = bounded_header_str(headers, "x-admin-token");
        if !provided.is_some_and(|provided| constant_time_eq(provided, expected)) {
            state.metrics.admin_auth_rejected();
            return Err((StatusCode::UNAUTHORIZED, "invalid admin token".to_string()));
        }
    }
    Ok(())
}

pub(crate) fn authorize_metrics(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, String)> {
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

pub(crate) fn authorize_account_session_issue(
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

pub(crate) fn authorize_origin(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (StatusCode, String)> {
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

pub(crate) fn session_reject_response(reason: SessionRejectReason) -> (StatusCode, String) {
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

pub(crate) fn player_id_for_auth(auth: &SessionAuth) -> PlayerId {
    match auth {
        SessionAuth::AnonymousDev => Uuid::new_v4(),
        SessionAuth::Ticket { session_id, .. } => *session_id,
    }
}

pub(crate) fn display_name_for_auth(auth: &SessionAuth) -> Option<String> {
    match auth {
        SessionAuth::AnonymousDev => None,
        SessionAuth::Ticket { display_name, .. } => display_name.clone(),
    }
}

pub(crate) fn account_subject_for_auth(auth: &SessionAuth) -> Option<String> {
    match auth {
        SessionAuth::AnonymousDev => None,
        SessionAuth::Ticket {
            account_subject, ..
        } => account_subject.clone(),
    }
}

pub(crate) fn bounded_header_str<'a>(
    headers: &'a HeaderMap,
    name: &'static str,
) -> Option<&'a str> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.len() <= MAX_AUTH_TOKEN_BYTES)
}

pub(crate) fn bounded_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|token| token.len() <= MAX_AUTH_TOKEN_BYTES)
}

pub(crate) fn constant_time_eq(provided: &str, expected: &str) -> bool {
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
