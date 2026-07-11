mod admin_routes;
mod admission;
mod auth;
mod config;
mod content;
mod http_routes;
mod ingress;
mod journal;
mod metrics;
mod metrics_routes;
mod npc;
mod persistence;
mod player_identity;
mod protocol;
mod readiness;
mod resource_replay;
mod routes;
mod runtime;
mod runtime_assets;
mod runtime_paths;
mod session;
mod session_routes;
mod settlement;
mod sim;
mod spatial;
mod terrain;
mod tick_loop;
mod ws;

use std::net::SocketAddr;

pub(crate) use config::{AdmissionBackend, DeploymentProfile, PersistenceBackend};
use routes::build_router;
use runtime::initialize_runtime;
pub(crate) use runtime::{AppState, DEFAULT_ADMIN_EVENT_LIMIT, SERVER_TICK_BUDGET};
use tick_loop::run_tick_loop;
use tokio::net::TcpListener;
use tracing::{error, info};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "sundermere_server=info,tower_http=info".into()),
        )
        .init();

    let runtime = initialize_runtime().await?;
    tokio::spawn(run_tick_loop(runtime.state.clone()));
    tokio::spawn(npc::dialogue::journal_spoken_replies(
        runtime.state.clone(),
        runtime.npc_reply_rx,
    ));
    if let Some(outputs) = runtime.npc_engine_outputs {
        tokio::spawn(npc::intent_pump::run_intent_pump(
            runtime.state.clone(),
            outputs,
        ));
    }

    let app = build_router(runtime.state, runtime.assets_dir, runtime.client_dir);

    let listener = TcpListener::bind(runtime.addr).await?;
    info!(addr = %runtime.addr, "Duskfell PoC server listening");
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

#[cfg(test)]
mod config_tests;
