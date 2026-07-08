use std::sync::atomic::Ordering;

use super::{update_max, AppMetrics};

impl AppMetrics {
    pub fn durable_journal_persist_failed(&self) {
        self.durable_journal_persist_failed_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn durable_settlement_persist_failed(&self) {
        self.durable_settlement_persist_failed_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn settlement_queue_full(&self) {
        self.settlement_queue_full_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn settlement_queue_closed(&self) {
        self.settlement_queue_closed_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn durable_journal_persist_failed_total(&self) -> u64 {
        self.durable_journal_persist_failed_total
            .load(Ordering::Relaxed)
    }

    pub fn durable_settlement_persist_failed_total(&self) -> u64 {
        self.durable_settlement_persist_failed_total
            .load(Ordering::Relaxed)
    }

    pub fn settlement_queue_full_total(&self) -> u64 {
        self.settlement_queue_full_total.load(Ordering::Relaxed)
    }

    pub fn settlement_queue_closed_total(&self) -> u64 {
        self.settlement_queue_closed_total.load(Ordering::Relaxed)
    }

    pub fn tick_observed(&self, duration_us: u64, overran_budget: bool) {
        self.tick_duration_last_us
            .store(duration_us, Ordering::Relaxed);
        update_max(&self.tick_duration_max_us, duration_us);
        if overran_budget {
            self.tick_overruns_total.fetch_add(1, Ordering::Relaxed);
        }
    }
}
