use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::config::{env_bool, env_positive_u64, env_positive_usize};
use crate::journal::{EventJournal, DEFAULT_RETAINED_EVENTS};
use crate::persistence::{
    ensure_file_within_size, load_journal_events, validate_distinct_durable_paths, DurableFileLock,
    JsonlEventWriter, DEFAULT_MAX_DURABLE_LINE_BYTES,
};
use crate::protocol::ResourceKind;
use crate::resource_replay::replay_resource_node_states;
use crate::runtime_paths::{journal_path, settlement_outbox_path};
use crate::settlement::{
    self, SettlementJob, SettlementLedgerHandle, SettlementOutbox, SettlementOutboxHandle,
};

use super::{DEFAULT_MAX_JOURNAL_BYTES, DEFAULT_MAX_SETTLEMENT_OUTBOX_BYTES};

pub(super) struct DurableRuntimeState {
    pub(super) settlement_outbox: SettlementOutboxHandle,
    pub(super) pending_settlement_jobs: Vec<SettlementJob>,
    pub(super) journal: Arc<Mutex<EventJournal>>,
    pub(super) journal_writer: Arc<Mutex<JsonlEventWriter>>,
    pub(super) journal_replayed_total_events: usize,
    pub(super) journal_retained_event_count: usize,
    pub(super) journal_sequence_anomalies: usize,
    pub(super) replayed_resource_nodes: HashMap<String, (ResourceKind, u32)>,
    pub(super) max_journal_bytes: u64,
    pub(super) max_settlement_outbox_bytes: u64,
    pub(super) max_durable_line_bytes: usize,
    pub(super) durable_sync_writes: bool,
    pub(super) journal_file_lock: Arc<DurableFileLock>,
    pub(super) settlement_outbox_file_lock: Arc<DurableFileLock>,
}

pub(super) async fn initialize_durable_runtime(
    settlement_ledger: &SettlementLedgerHandle,
) -> anyhow::Result<DurableRuntimeState> {
    let max_journal_bytes = env_positive_u64("MAX_JOURNAL_BYTES", DEFAULT_MAX_JOURNAL_BYTES)?;
    let max_settlement_outbox_bytes = env_positive_u64(
        "MAX_SETTLEMENT_OUTBOX_BYTES",
        DEFAULT_MAX_SETTLEMENT_OUTBOX_BYTES,
    )?;
    let durable_sync_writes = env_bool("DURABLE_SYNC_WRITES", false)?;
    let max_durable_line_bytes =
        env_positive_usize("MAX_DURABLE_LINE_BYTES", DEFAULT_MAX_DURABLE_LINE_BYTES)?;
    let settlement_outbox_path = settlement_outbox_path();
    let journal_path = journal_path();
    validate_distinct_durable_paths(&journal_path, &settlement_outbox_path)?;
    let settlement_outbox_file_lock = Arc::new(DurableFileLock::acquire_for_path(
        &settlement_outbox_path,
        "settlement outbox",
    )?);
    let journal_file_lock = Arc::new(DurableFileLock::acquire_for_path(&journal_path, "journal")?);
    ensure_file_within_size(
        &settlement_outbox_path,
        max_settlement_outbox_bytes,
        "MAX_SETTLEMENT_OUTBOX_BYTES",
        "settlement outbox",
    )?;
    let (settlement_outbox, pending_settlement_jobs, confirmed_receipts) =
        SettlementOutbox::open_with_options(
            settlement_outbox_path,
            durable_sync_writes,
            max_durable_line_bytes,
        )?;
    let settlement_outbox = Arc::new(Mutex::new(settlement_outbox));
    settlement::seed_confirmed_receipts(confirmed_receipts, settlement_ledger).await;

    let journal_retained_events =
        env_positive_usize("JOURNAL_RETAINED_EVENTS", DEFAULT_RETAINED_EVENTS)?;
    ensure_file_within_size(
        &journal_path,
        max_journal_bytes,
        "MAX_JOURNAL_BYTES",
        "journal",
    )?;
    let replayed_journal = load_journal_events(
        &journal_path,
        journal_retained_events,
        max_durable_line_bytes,
    )?;
    let replayed_resource_nodes =
        replay_resource_node_states(&journal_path, max_durable_line_bytes)?;
    let journal_retained_event_count = replayed_journal.events.len();
    let journal = Arc::new(Mutex::new(EventJournal::from_replayed(
        replayed_journal.events,
        replayed_journal.next_sequence,
        journal_retained_events,
    )));
    let journal_writer = Arc::new(Mutex::new(JsonlEventWriter::open_with_sync(
        journal_path,
        durable_sync_writes,
    )?));

    Ok(DurableRuntimeState {
        settlement_outbox,
        pending_settlement_jobs,
        journal,
        journal_writer,
        journal_replayed_total_events: replayed_journal.total_events,
        journal_retained_event_count,
        journal_sequence_anomalies: replayed_journal.sequence_anomalies,
        replayed_resource_nodes,
        max_journal_bytes,
        max_settlement_outbox_bytes,
        max_durable_line_bytes,
        durable_sync_writes,
        journal_file_lock,
        settlement_outbox_file_lock,
    })
}
