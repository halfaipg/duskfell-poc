use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::{mpsc, Mutex};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::metrics::AppMetrics;
use crate::persistence::for_each_jsonl_line;
#[cfg(test)]
use crate::persistence::DEFAULT_MAX_DURABLE_LINE_BYTES;
use crate::protocol::{PlayerId, SettlementReceiptSnapshot, SettlementSnapshot};

const MAX_SETTLEMENT_ASSET_ID_BYTES: usize = 96;
const MAX_SETTLEMENT_REASON_BYTES: usize = 96;
const MAX_SETTLEMENT_STATUS_BYTES: usize = 160;
const MAX_SETTLEMENT_CHAIN_TX_BYTES: usize = 128;
const MAX_ACCOUNT_SUBJECT_BYTES: usize = 128;

#[derive(Debug, Clone)]
pub struct SettlementConfig {
    pub chain_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettlementJob {
    pub job_id: Uuid,
    pub player_id: PlayerId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_subject: Option<String>,
    pub asset_id: String,
    pub reason: String,
}

#[derive(Debug, Default)]
pub struct SettlementLedger {
    pending_job_ids: HashSet<Uuid>,
    confirmed_job_ids: HashSet<Uuid>,
    confirmed: VecDeque<SettlementReceiptSnapshot>,
    ownership: HashMap<String, SettlementReceiptSnapshot>,
}

pub type SettlementLedgerHandle = Arc<Mutex<SettlementLedger>>;
pub type SettlementOutboxHandle = Arc<Mutex<SettlementOutbox>>;

impl SettlementLedger {
    pub fn enqueued(&mut self, job_id: Uuid) {
        if !self.confirmed_job_ids.contains(&job_id) {
            self.pending_job_ids.insert(job_id);
        }
    }

    pub fn confirmed(&mut self, receipt: SettlementReceiptSnapshot) {
        if !self.confirmed_job_ids.insert(receipt.job_id) {
            return;
        }

        self.pending_job_ids.remove(&receipt.job_id);
        self.ownership
            .insert(receipt.asset_id.clone(), receipt.clone());
        self.confirmed.push_back(receipt);
        while self.confirmed.len() > 32 {
            self.confirmed.pop_front();
        }
    }

    pub fn snapshot(&self, chain_enabled: bool) -> SettlementSnapshot {
        SettlementSnapshot {
            chain_enabled,
            pending_jobs: self.pending_job_ids.len(),
            confirmed_jobs: self.confirmed.len(),
            owned_assets: self.ownership.len(),
            latest_receipt: self.confirmed.back().cloned(),
        }
    }

    pub fn ownership(&self) -> Vec<SettlementReceiptSnapshot> {
        let mut ownership = self.ownership.values().cloned().collect::<Vec<_>>();
        ownership.sort_by(|a, b| a.asset_id.cmp(&b.asset_id));
        ownership
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SettlementOutboxEvent {
    JobQueued { job: SettlementJob },
    JobConfirmed { receipt: SettlementReceiptSnapshot },
}

#[derive(Debug)]
pub struct SettlementOutbox {
    path: PathBuf,
    file: File,
    events_written: usize,
    sync_writes: bool,
}

impl SettlementOutbox {
    #[cfg(test)]
    pub fn open(
        path: impl AsRef<Path>,
    ) -> anyhow::Result<(Self, Vec<SettlementJob>, Vec<SettlementReceiptSnapshot>)> {
        Self::open_with_options(path, false, DEFAULT_MAX_DURABLE_LINE_BYTES)
    }

    #[cfg(test)]
    pub fn open_with_sync(
        path: impl AsRef<Path>,
        sync_writes: bool,
    ) -> anyhow::Result<(Self, Vec<SettlementJob>, Vec<SettlementReceiptSnapshot>)> {
        Self::open_with_options(path, sync_writes, DEFAULT_MAX_DURABLE_LINE_BYTES)
    }

    pub fn open_with_options(
        path: impl AsRef<Path>,
        sync_writes: bool,
        max_line_bytes: usize,
    ) -> anyhow::Result<(Self, Vec<SettlementJob>, Vec<SettlementReceiptSnapshot>)> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).with_context(|| {
                format!(
                    "failed to create settlement outbox dir {}",
                    parent.display()
                )
            })?;
        }

        let (pending, receipts, events_written) = Self::load_state(&path, max_line_bytes)?;
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .with_context(|| format!("failed to open settlement outbox {}", path.display()))?;

        Ok((
            Self {
                path,
                file,
                events_written,
                sync_writes,
            },
            pending,
            receipts,
        ))
    }

    pub fn append_job(&mut self, job: &SettlementJob) -> anyhow::Result<()> {
        validate_job(job)?;
        self.append(&SettlementOutboxEvent::JobQueued { job: job.clone() })
    }

    pub fn append_receipt(&mut self, receipt: &SettlementReceiptSnapshot) -> anyhow::Result<()> {
        validate_receipt(receipt)?;
        self.append(&SettlementOutboxEvent::JobConfirmed {
            receipt: receipt.clone(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn events_written(&self) -> usize {
        self.events_written
    }

    #[cfg(test)]
    pub fn sync_writes(&self) -> bool {
        self.sync_writes
    }

    fn append(&mut self, event: &SettlementOutboxEvent) -> anyhow::Result<()> {
        serde_json::to_writer(&mut self.file, event).with_context(|| {
            format!(
                "failed to serialize settlement outbox {}",
                self.path.display()
            )
        })?;
        self.file.write_all(b"\n").with_context(|| {
            format!(
                "failed to write settlement outbox newline {}",
                self.path.display()
            )
        })?;
        self.file.flush().with_context(|| {
            format!("failed to flush settlement outbox {}", self.path.display())
        })?;
        if self.sync_writes {
            self.file.sync_data().with_context(|| {
                format!("failed to sync settlement outbox {}", self.path.display())
            })?;
        }
        self.events_written += 1;
        Ok(())
    }

    fn load_state(
        path: &Path,
        max_line_bytes: usize,
    ) -> anyhow::Result<(Vec<SettlementJob>, Vec<SettlementReceiptSnapshot>, usize)> {
        if !path.exists() {
            return Ok((Vec::new(), Vec::new(), 0));
        }

        let mut queued = HashMap::<Uuid, SettlementJob>::new();
        let mut confirmed_job_ids = HashSet::<Uuid>::new();
        let mut receipts = Vec::new();
        let mut events_written = 0;

        for_each_jsonl_line(
            path,
            max_line_bytes,
            "settlement outbox",
            |line_number, line| {
                if line.trim().is_empty() {
                    return Ok(());
                }
                events_written += 1;
                let event: SettlementOutboxEvent =
                    serde_json::from_str(&line).with_context(|| {
                        format!(
                            "failed to parse settlement outbox line {} from {}",
                            line_number,
                            path.display()
                        )
                    })?;
                match event {
                    SettlementOutboxEvent::JobQueued { job } => {
                        validate_job(&job).with_context(|| {
                            format!(
                                "invalid settlement job in outbox line {} from {}",
                                line_number,
                                path.display()
                            )
                        })?;
                        if !confirmed_job_ids.contains(&job.job_id) {
                            queued.entry(job.job_id).or_insert(job);
                        }
                    }
                    SettlementOutboxEvent::JobConfirmed { receipt } => {
                        validate_receipt(&receipt).with_context(|| {
                            format!(
                                "invalid settlement receipt in outbox line {} from {}",
                                line_number,
                                path.display()
                            )
                        })?;
                        if confirmed_job_ids.insert(receipt.job_id) {
                            queued.remove(&receipt.job_id);
                            receipts.push(receipt);
                        }
                    }
                }
                Ok(())
            },
        )?;

        Ok((queued.into_values().collect(), receipts, events_written))
    }
}

fn validate_job(job: &SettlementJob) -> anyhow::Result<()> {
    if let Some(account_subject) = &job.account_subject {
        validate_text_field(
            "settlement job accountSubject",
            account_subject,
            MAX_ACCOUNT_SUBJECT_BYTES,
        )?;
    }
    validate_tokenish_field(
        "settlement job assetId",
        &job.asset_id,
        MAX_SETTLEMENT_ASSET_ID_BYTES,
    )?;
    validate_text_field(
        "settlement job reason",
        &job.reason,
        MAX_SETTLEMENT_REASON_BYTES,
    )
}

fn validate_receipt(receipt: &SettlementReceiptSnapshot) -> anyhow::Result<()> {
    if let Some(account_subject) = &receipt.account_subject {
        validate_text_field(
            "settlement receipt accountSubject",
            account_subject,
            MAX_ACCOUNT_SUBJECT_BYTES,
        )?;
    }
    validate_tokenish_field(
        "settlement receipt assetId",
        &receipt.asset_id,
        MAX_SETTLEMENT_ASSET_ID_BYTES,
    )?;
    validate_text_field(
        "settlement receipt status",
        &receipt.status,
        MAX_SETTLEMENT_STATUS_BYTES,
    )?;
    if let Some(chain_tx) = &receipt.chain_tx {
        validate_text_field(
            "settlement receipt chainTx",
            chain_tx,
            MAX_SETTLEMENT_CHAIN_TX_BYTES,
        )?;
    }
    Ok(())
}

fn validate_tokenish_field(field: &str, value: &str, max_bytes: usize) -> anyhow::Result<()> {
    validate_text_field(field, value, max_bytes)?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
    {
        return Err(anyhow!(
            "{field} must contain only ASCII letters, digits, '-', '_', ':', or '.'"
        ));
    }
    Ok(())
}

fn validate_text_field(field: &str, value: &str, max_bytes: usize) -> anyhow::Result<()> {
    if value.trim().is_empty() {
        return Err(anyhow!("{field} must be non-empty"));
    }
    if value.trim() != value {
        return Err(anyhow!("{field} must not have surrounding whitespace"));
    }
    if value.len() > max_bytes {
        return Err(anyhow!("{field} must be at most {max_bytes} bytes"));
    }
    if !value.is_ascii() || value.chars().any(char::is_control) {
        return Err(anyhow!("{field} must be printable ASCII"));
    }
    Ok(())
}

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

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn temp_path() -> PathBuf {
        std::env::temp_dir().join(format!("sundermere-settlement-{}.jsonl", Uuid::new_v4()))
    }

    fn test_job(asset_id: &str) -> SettlementJob {
        SettlementJob {
            job_id: Uuid::new_v4(),
            player_id: Uuid::new_v4(),
            account_subject: None,
            asset_id: asset_id.to_string(),
            reason: "test".to_string(),
        }
    }

    #[test]
    fn outbox_replays_unconfirmed_jobs_only() {
        let path = temp_path();
        let player_id = Uuid::new_v4();
        let job_a = SettlementJob {
            job_id: Uuid::new_v4(),
            player_id,
            account_subject: None,
            asset_id: "asset-a".to_string(),
            reason: "test".to_string(),
        };
        let job_b = SettlementJob {
            job_id: Uuid::new_v4(),
            player_id,
            account_subject: None,
            asset_id: "asset-b".to_string(),
            reason: "test".to_string(),
        };
        let receipt_a = SettlementReceiptSnapshot {
            job_id: job_a.job_id,
            player_id,
            account_subject: None,
            asset_id: job_a.asset_id.clone(),
            status: "dry-run-confirmed:test".to_string(),
            chain_tx: None,
        };

        {
            let (mut outbox, _, _) = SettlementOutbox::open(&path).expect("outbox opens");
            outbox.append_job(&job_a).expect("job a appends");
            outbox.append_job(&job_b).expect("job b appends");
            outbox.append_receipt(&receipt_a).expect("receipt appends");
        }

        let (_, pending, receipts) = SettlementOutbox::open(&path).expect("outbox reloads");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].job_id, job_b.job_id);
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].job_id, job_a.job_id);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn outbox_preserves_account_subject_on_jobs_and_receipts() {
        let path = temp_path();
        let player_id = Uuid::new_v4();
        let account_subject = "acct:wallet:0xabc123".to_string();
        let job = SettlementJob {
            job_id: Uuid::new_v4(),
            player_id,
            account_subject: Some(account_subject.clone()),
            asset_id: "asset-account-bound".to_string(),
            reason: "test".to_string(),
        };
        let receipt = SettlementReceiptSnapshot {
            job_id: job.job_id,
            player_id,
            account_subject: Some(account_subject.clone()),
            asset_id: job.asset_id.clone(),
            status: "dry-run-confirmed:test".to_string(),
            chain_tx: None,
        };

        {
            let (mut outbox, _, _) = SettlementOutbox::open(&path).expect("outbox opens");
            outbox.append_job(&job).expect("job appends");
            outbox.append_receipt(&receipt).expect("receipt appends");
        }

        let (_, pending, receipts) = SettlementOutbox::open(&path).expect("outbox reloads");
        assert!(pending.is_empty());
        assert_eq!(receipts.len(), 1);
        assert_eq!(
            receipts[0].account_subject.as_deref(),
            Some(account_subject.as_str())
        );

        let _ = fs::remove_file(path);
    }

    #[test]
    fn outbox_appends_and_replays_with_sync_enabled() {
        let path = temp_path();
        let player_id = Uuid::new_v4();
        let job = SettlementJob {
            job_id: Uuid::new_v4(),
            player_id,
            account_subject: None,
            asset_id: "asset-synced".to_string(),
            reason: "test".to_string(),
        };

        {
            let (mut outbox, _, _) =
                SettlementOutbox::open_with_sync(&path, true).expect("outbox opens");
            outbox.append_job(&job).expect("job appends");
            assert!(outbox.sync_writes());
            assert_eq!(outbox.events_written(), 1);
        }

        let (_, pending, receipts) = SettlementOutbox::open(&path).expect("outbox reloads");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].job_id, job.job_id);
        assert!(receipts.is_empty());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn malformed_outbox_event_fails_replay() {
        let path = temp_path();
        fs::write(&path, b"{not-json}\n").expect("malformed outbox writes");

        let err = SettlementOutbox::open(&path).expect_err("malformed outbox should fail");

        assert!(err
            .to_string()
            .contains("failed to parse settlement outbox line 1"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn oversized_outbox_line_fails_replay_before_parse() {
        let path = temp_path();
        fs::write(&path, b"{\"tooLong\":true}\n").expect("oversized outbox writes");

        let err = SettlementOutbox::open_with_options(&path, false, 8)
            .expect_err("oversized line should fail");

        assert!(err.to_string().contains("settlement outbox line 1"));
        assert!(err.to_string().contains("MAX_DURABLE_LINE_BYTES"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn outbox_replay_rejects_invalid_job_fields() {
        let path = temp_path();
        let player_id = Uuid::new_v4();
        let raw = serde_json::json!({
            "type": "jobQueued",
            "job": {
                "jobId": Uuid::new_v4(),
                "playerId": player_id,
                "assetId": "",
                "reason": "test"
            }
        });
        fs::write(&path, format!("{raw}\n")).expect("invalid job writes");

        let err = SettlementOutbox::open(&path).expect_err("invalid job should fail");

        assert!(format!("{err:?}").contains("settlement job assetId"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn outbox_replay_rejects_invalid_account_subject_fields() {
        let path = temp_path();
        let player_id = Uuid::new_v4();
        let raw = serde_json::json!({
            "type": "jobQueued",
            "job": {
                "jobId": Uuid::new_v4(),
                "playerId": player_id,
                "accountSubject": " acct:bad ",
                "assetId": "asset-a",
                "reason": "test"
            }
        });
        fs::write(&path, format!("{raw}\n")).expect("invalid account subject writes");

        let err = SettlementOutbox::open(&path).expect_err("invalid account subject should fail");

        assert!(format!("{err:?}").contains("settlement job accountSubject"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn outbox_replay_rejects_invalid_receipt_fields() {
        let path = temp_path();
        let player_id = Uuid::new_v4();
        let raw = serde_json::json!({
            "type": "jobConfirmed",
            "receipt": {
                "jobId": Uuid::new_v4(),
                "playerId": player_id,
                "assetId": "asset-a",
                "status": "",
                "chainTx": null
            }
        });
        fs::write(&path, format!("{raw}\n")).expect("invalid receipt writes");

        let err = SettlementOutbox::open(&path).expect_err("invalid receipt should fail");

        assert!(format!("{err:?}").contains("settlement receipt status"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn outbox_replay_ignores_duplicate_job_and_receipt_events() {
        let path = temp_path();
        let player_id = Uuid::new_v4();
        let confirmed_job = SettlementJob {
            job_id: Uuid::new_v4(),
            player_id,
            account_subject: None,
            asset_id: "asset-confirmed".to_string(),
            reason: "test".to_string(),
        };
        let pending_job = SettlementJob {
            job_id: Uuid::new_v4(),
            player_id,
            account_subject: None,
            asset_id: "asset-pending".to_string(),
            reason: "test".to_string(),
        };
        let receipt = SettlementReceiptSnapshot {
            job_id: confirmed_job.job_id,
            player_id,
            account_subject: None,
            asset_id: confirmed_job.asset_id.clone(),
            status: "dry-run-confirmed:test".to_string(),
            chain_tx: None,
        };

        {
            let (mut outbox, _, _) = SettlementOutbox::open(&path).expect("outbox opens");
            outbox
                .append_job(&confirmed_job)
                .expect("confirmed job appends");
            outbox
                .append_job(&confirmed_job)
                .expect("duplicate confirmed job appends");
            outbox.append_receipt(&receipt).expect("receipt appends");
            outbox
                .append_receipt(&receipt)
                .expect("duplicate receipt appends");
            outbox
                .append_job(&confirmed_job)
                .expect("late duplicate confirmed job appends");
            outbox
                .append_job(&pending_job)
                .expect("pending job appends");
            outbox
                .append_job(&pending_job)
                .expect("duplicate pending job appends");
        }

        let (_, pending, receipts) = SettlementOutbox::open(&path).expect("outbox reloads");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].job_id, pending_job.job_id);
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].job_id, confirmed_job.job_id);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn ledger_tracks_latest_receipt_per_asset() {
        let player_id = Uuid::new_v4();
        let mut ledger = SettlementLedger::default();
        let first = SettlementReceiptSnapshot {
            job_id: Uuid::new_v4(),
            player_id,
            account_subject: None,
            asset_id: "asset-a".to_string(),
            status: "dry-run-confirmed:first".to_string(),
            chain_tx: None,
        };
        let second = SettlementReceiptSnapshot {
            job_id: Uuid::new_v4(),
            player_id,
            account_subject: None,
            asset_id: "asset-a".to_string(),
            status: "dry-run-confirmed:second".to_string(),
            chain_tx: None,
        };

        ledger.confirmed(first);
        ledger.confirmed(second.clone());

        let settlement = ledger.snapshot(false);
        assert_eq!(settlement.confirmed_jobs, 2);
        assert_eq!(settlement.owned_assets, 1);
        assert_eq!(ledger.ownership(), vec![second]);
    }

    #[test]
    fn ledger_counts_duplicate_enqueue_and_confirm_once() {
        let player_id = Uuid::new_v4();
        let job_id = Uuid::new_v4();
        let mut ledger = SettlementLedger::default();
        let receipt = SettlementReceiptSnapshot {
            job_id,
            player_id,
            account_subject: None,
            asset_id: "asset-a".to_string(),
            status: "dry-run-confirmed:test".to_string(),
            chain_tx: None,
        };

        ledger.enqueued(job_id);
        ledger.enqueued(job_id);
        assert_eq!(ledger.snapshot(false).pending_jobs, 1);

        ledger.confirmed(receipt.clone());
        ledger.confirmed(receipt);
        let settlement = ledger.snapshot(false);
        assert_eq!(settlement.pending_jobs, 0);
        assert_eq!(settlement.confirmed_jobs, 1);
        assert_eq!(settlement.owned_assets, 1);

        ledger.enqueued(job_id);
        assert_eq!(ledger.snapshot(false).pending_jobs, 0);
    }

    #[tokio::test]
    async fn enqueue_persisted_job_does_not_block_when_queue_is_full() {
        let path = temp_path();
        let (outbox, _, _) = SettlementOutbox::open(&path).expect("outbox opens");
        let outbox = Arc::new(Mutex::new(outbox));
        let ledger = Arc::new(Mutex::new(SettlementLedger::default()));
        let metrics = AppMetrics::default();
        let (tx, _rx) = channel_with_capacity(1);

        enqueue_persisted_job(test_job("asset-a"), &tx, &ledger, &outbox, &metrics)
            .await
            .expect("first job fills queue");

        let second = enqueue_persisted_job(test_job("asset-b"), &tx, &ledger, &outbox, &metrics);
        let err = tokio::time::timeout(Duration::from_millis(50), second)
            .await
            .expect("full queue returns without awaiting capacity")
            .expect_err("second job should see queue pressure");

        assert!(err.to_string().contains("settlement queue full"));
        assert_eq!(metrics.settlement_queue_full_total(), 1);
        assert_eq!(metrics.settlement_queue_closed_total(), 0);
        assert_eq!(metrics.durable_settlement_persist_failed_total(), 0);
        assert_eq!(outbox.lock().await.events_written(), 2);
        assert_eq!(ledger.lock().await.snapshot(false).pending_jobs, 2);

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn seeding_confirmed_receipts_rebuilds_all_ownership() {
        let ledger = Arc::new(Mutex::new(SettlementLedger::default()));
        let player_id = Uuid::new_v4();
        let receipts = (0..40)
            .map(|index| SettlementReceiptSnapshot {
                job_id: Uuid::new_v4(),
                player_id,
                account_subject: None,
                asset_id: format!("asset-{index:02}"),
                status: "dry-run-confirmed:test".to_string(),
                chain_tx: None,
            })
            .collect::<Vec<_>>();

        seed_confirmed_receipts(receipts, &ledger).await;

        let ledger = ledger.lock().await;
        let settlement = ledger.snapshot(false);
        assert_eq!(settlement.confirmed_jobs, 32);
        assert_eq!(settlement.owned_assets, 40);
        assert_eq!(ledger.ownership().len(), 40);
    }
}
