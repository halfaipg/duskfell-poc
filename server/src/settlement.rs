use std::sync::Arc;

use tokio::sync::Mutex;

mod ledger;
mod model;
mod outbox;
mod validation;
mod worker;

pub use self::ledger::SettlementLedger;
pub use self::model::{SettlementConfig, SettlementJob};
pub use self::outbox::SettlementOutbox;
#[cfg(test)]
pub use self::worker::channel_with_capacity;
pub use self::worker::{
    channel, enqueue_persisted_job, replay_pending_jobs, run_worker, seed_confirmed_receipts,
};

pub type SettlementLedgerHandle = Arc<Mutex<SettlementLedger>>;
pub type SettlementOutboxHandle = Arc<Mutex<SettlementOutbox>>;

#[cfg(test)]
mod tests;
