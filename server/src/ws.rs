use std::net::SocketAddr;

use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{ConnectInfo, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;

use crate::admission::{AccountConnectionPermit, PeerConnectionPermit};
use crate::auth::{
    account_subject_for_auth, authorize_origin, display_name_for_auth, player_id_for_auth,
    session_reject_response,
};
use crate::AppState;

mod client_messages;
mod connection;
mod snapshots;

#[derive(Debug, Deserialize)]
pub(crate) struct WsQuery {
    session: Option<String>,
}

pub(crate) async fn ws_handler(
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

    let preflight = match state.sessions.lock().await.preflight_validate(
        query.session.as_deref(),
        state.session_config.require_session,
    ) {
        Ok(preflight) => preflight,
        Err(reason) => {
            state.metrics.session_ticket_rejected();
            return session_reject_response(reason).into_response();
        }
    };

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

    let Some(account_permit) =
        AccountConnectionPermit::try_acquire(&state, preflight.account_subject.as_deref()).await
    else {
        state.metrics.ws_account_capacity_rejected();
        peer_permit.release().await;
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "server account connection capacity reached".to_string(),
        )
            .into_response();
    };

    let auth = match state.sessions.lock().await.validate(
        query.session.as_deref(),
        state.session_config.require_session,
    ) {
        Ok(auth) => auth,
        Err(reason) => {
            account_permit.release().await;
            peer_permit.release().await;
            state.metrics.session_ticket_rejected();
            return session_reject_response(reason).into_response();
        }
    };
    let player_id = player_id_for_auth(&auth);
    let display_name = display_name_for_auth(&auth);
    let account_subject = account_subject_for_auth(&auth);

    ws.on_upgrade(move |socket| {
        connection::player_socket(
            socket,
            state,
            connection_permit,
            peer_permit,
            account_permit,
            player_id,
            display_name,
            account_subject,
        )
    })
    .into_response()
}
