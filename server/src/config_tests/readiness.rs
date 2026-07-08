use crate::metrics::AppMetrics;
use crate::readiness::{
    durable_parent_status, durable_persistence_check, redacted_durable_path_basename,
    settlement_queue_capacity_check,
};
use crate::settlement::{self, SettlementJob};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[test]
fn durable_parent_status_accepts_existing_mutable_directory() {
    let path = std::env::temp_dir().join("sundermere-ready-test.jsonl");

    let status = durable_parent_status(&path);

    assert!(status.ok, "{}", status.detail);
    assert!(status.detail.contains("not read-only"));
    assert!(!status
        .detail
        .contains(&std::env::temp_dir().display().to_string()));
}

#[test]
fn durable_parent_status_rejects_non_directory_parent() {
    let parent_file = unique_temp_path("sundermere-ready-parent");
    fs::write(&parent_file, b"not a directory").expect("write parent marker");

    let status = durable_parent_status(&parent_file.join("journal.jsonl"));
    let parent_file_display = parent_file.display().to_string();

    let _ = fs::remove_file(parent_file);
    assert!(!status.ok);
    assert!(
        status.detail.contains("not a directory") || status.detail.contains("not accessible"),
        "{}",
        status.detail
    );
    assert!(!status.detail.contains(&parent_file_display));
}

#[test]
fn durable_path_redaction_keeps_only_expected_basenames() {
    assert_eq!(
        redacted_durable_path_basename(PathBuf::from("/var/dusk/123-journal.jsonl").as_path()),
        "journal.jsonl"
    );
    assert_eq!(
        redacted_durable_path_basename(
            PathBuf::from("/var/dusk/123-settlement-outbox.jsonl").as_path()
        ),
        "settlement-outbox.jsonl"
    );
    assert_eq!(
        redacted_durable_path_basename(PathBuf::from("/var/dusk/private-ledger.jsonl").as_path()),
        "redacted.jsonl"
    );
    assert_eq!(
        redacted_durable_path_basename(PathBuf::from("/var/dusk/private-ledger.log").as_path()),
        "redacted"
    );
}

#[test]
fn durable_persistence_failures_make_readiness_unhealthy() {
    let metrics = AppMetrics::default();

    let healthy = durable_persistence_check(&metrics);
    assert!(healthy.ok);
    assert_eq!(healthy.name, "durablePersistenceHealthy");

    metrics.durable_journal_persist_failed();
    let journal_failed = durable_persistence_check(&metrics);
    assert!(!journal_failed.ok);
    assert!(journal_failed.detail.contains("1 journal persist failures"));
    assert!(journal_failed
        .detail
        .contains("0 settlement persist failures"));

    metrics.durable_settlement_persist_failed();
    let both_failed = durable_persistence_check(&metrics);
    assert!(!both_failed.ok);
    assert!(both_failed.detail.contains("1 journal persist failures"));
    assert!(both_failed.detail.contains("1 settlement persist failures"));
}

#[test]
fn full_settlement_queue_makes_readiness_unhealthy() {
    let (tx, _rx) = settlement::channel_with_capacity(1);

    let healthy = settlement_queue_capacity_check(&tx);
    assert!(healthy.ok);
    assert_eq!(healthy.name, "settlementQueueCapacityAvailable");
    assert!(healthy.detail.contains("1/1 settlement queue slots"));

    tx.try_send(SettlementJob {
        job_id: Uuid::new_v4(),
        player_id: Uuid::new_v4(),
        account_subject: None,
        asset_id: "asset-ready-test".to_string(),
        reason: "test".to_string(),
    })
    .expect("queue fills");

    let full = settlement_queue_capacity_check(&tx);
    assert!(!full.ok);
    assert!(full.detail.contains("0/1 settlement queue slots"));
}

fn unique_temp_path(prefix: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{}-{nonce}", std::process::id()))
}
