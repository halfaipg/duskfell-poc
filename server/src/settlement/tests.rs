use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;
use uuid::Uuid;

use crate::metrics::AppMetrics;
use crate::protocol::SettlementReceiptSnapshot;

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
