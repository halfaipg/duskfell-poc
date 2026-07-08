use std::path::Path;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;
use tokio::sync::mpsc;

use crate::content::ContentManifest;
use crate::metrics::AppMetrics;
use crate::settlement::SettlementJob;
use crate::{AdmissionBackend, AppState, PersistenceBackend};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadinessCheck {
    pub(crate) name: &'static str,
    pub(crate) ok: bool,
    pub(crate) detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadinessStatus {
    ready: bool,
    checks: Vec<ReadinessCheck>,
    content: ContentManifest,
}

pub(crate) async fn readyz(State(state): State<AppState>) -> impl IntoResponse {
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
        name: "persistenceBackendActive",
        ok: state.persistence_backend == PersistenceBackend::Jsonl,
        detail: format!(
            "{} persistence backend active",
            state.persistence_backend.name()
        ),
    });
    checks.push(ReadinessCheck {
        name: "admissionBackendActive",
        ok: state.admission_backend == AdmissionBackend::InMemory,
        detail: format!(
            "{} admission backend active",
            state.admission_backend.name()
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

pub(crate) fn durable_persistence_check(metrics: &AppMetrics) -> ReadinessCheck {
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

pub(crate) fn settlement_queue_capacity_check(tx: &mpsc::Sender<SettlementJob>) -> ReadinessCheck {
    let available = tx.capacity();
    let maximum = tx.max_capacity();
    ReadinessCheck {
        name: "settlementQueueCapacityAvailable",
        ok: available > 0,
        detail: format!("{available}/{maximum} settlement queue slots available"),
    }
}

#[derive(Debug)]
pub(crate) struct DurableParentStatus {
    pub(crate) ok: bool,
    pub(crate) detail: String,
}

pub(crate) fn durable_parent_status(path: &Path) -> DurableParentStatus {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));

    match parent.metadata() {
        Ok(metadata) if metadata.is_dir() && !metadata.permissions().readonly() => {
            DurableParentStatus {
                ok: true,
                detail: "durable parent directory exists and is not read-only".to_string(),
            }
        }
        Ok(metadata) if !metadata.is_dir() => DurableParentStatus {
            ok: false,
            detail: "durable parent path is not a directory".to_string(),
        },
        Ok(_) => DurableParentStatus {
            ok: false,
            detail: "durable parent directory is read-only".to_string(),
        },
        Err(err) => DurableParentStatus {
            ok: false,
            detail: format!("durable parent directory is not accessible: {err}"),
        },
    }
}

pub(crate) fn redacted_durable_path_basename(path: &Path) -> String {
    let Some(basename) = path.file_name().and_then(|name| name.to_str()) else {
        return "redacted".to_string();
    };

    if basename.ends_with("settlement-outbox.jsonl") {
        "settlement-outbox.jsonl".to_string()
    } else if basename.ends_with("journal.jsonl") {
        "journal.jsonl".to_string()
    } else if basename.ends_with(".jsonl") {
        "redacted.jsonl".to_string()
    } else {
        "redacted".to_string()
    }
}
