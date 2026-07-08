use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context};
use tokio::sync::mpsc;
use tokio::sync::mpsc::error::TrySendError;
use tracing::{error, info, warn};

use crate::metrics::AppMetrics;
use crate::protocol::SettlementReceiptSnapshot;

use super::{SettlementConfig, SettlementJob, SettlementLedgerHandle, SettlementOutboxHandle};

pub fn channel() -> (mpsc::Sender<SettlementJob>, mpsc::Receiver<SettlementJob>) {
    channel_with_capacity(256)
}

pub fn channel_with_capacity(
    capacity: usize,
) -> (mpsc::Sender<SettlementJob>, mpsc::Receiver<SettlementJob>) {
    mpsc::channel(capacity)
}

pub async fn run_worker(
    config: SettlementConfig,
    mut jobs: mpsc::Receiver<SettlementJob>,
    ledger: SettlementLedgerHandle,
    outbox: SettlementOutboxHandle,
    metrics: Arc<AppMetrics>,
) {
    info!(
        chain_enabled = config.chain_enabled,
        "settlement worker online"
    );

    while let Some(job) = jobs.recv().await {
        if config.chain_enabled {
            warn!(
                job_id = %job.job_id,
                "chain mode is enabled but no signer is configured in this PoC"
            );
        }

        tokio::time::sleep(Duration::from_millis(450)).await;
        let receipt = SettlementReceiptSnapshot {
            job_id: job.job_id,
            player_id: job.player_id,
            account_subject: job.account_subject,
            asset_id: job.asset_id,
            status: if config.chain_enabled {
                "needs-signer".to_string()
            } else {
                format!("dry-run-confirmed:{}", job.reason)
            },
            chain_tx: None,
        };

        if let Err(err) = outbox.lock().await.append_receipt(&receipt) {
            metrics.durable_settlement_persist_failed();
            error!(%err, job_id = %receipt.job_id, "failed to persist settlement receipt");
            continue;
        }

        ledger.lock().await.confirmed(receipt);
    }
}

pub async fn enqueue_persisted_job(
    job: SettlementJob,
    tx: &mpsc::Sender<SettlementJob>,
    ledger: &SettlementLedgerHandle,
    outbox: &SettlementOutboxHandle,
    metrics: &AppMetrics,
) -> anyhow::Result<()> {
    outbox.lock().await.append_job(&job).map_err(|err| {
        metrics.durable_settlement_persist_failed();
        err
    })?;
    ledger.lock().await.enqueued(job.job_id);
    match tx.try_send(job) {
        Ok(()) => Ok(()),
        Err(TrySendError::Full(job)) => {
            metrics.settlement_queue_full();
            Err(anyhow!("settlement queue full for job {}", job.job_id))
        }
        Err(TrySendError::Closed(job)) => {
            metrics.settlement_queue_closed();
            Err(anyhow!("settlement queue closed for job {}", job.job_id))
        }
    }
}

pub async fn replay_pending_jobs(
    pending_jobs: Vec<SettlementJob>,
    tx: &mpsc::Sender<SettlementJob>,
    ledger: &SettlementLedgerHandle,
) -> anyhow::Result<usize> {
    let count = pending_jobs.len();
    for job in pending_jobs {
        ledger.lock().await.enqueued(job.job_id);
        tx.send(job)
            .await
            .context("settlement queue closed during replay")?;
    }
    Ok(count)
}

pub async fn seed_confirmed_receipts(
    receipts: Vec<SettlementReceiptSnapshot>,
    ledger: &SettlementLedgerHandle,
) {
    let mut ledger = ledger.lock().await;
    for receipt in receipts {
        ledger.confirmed(receipt);
    }
}
