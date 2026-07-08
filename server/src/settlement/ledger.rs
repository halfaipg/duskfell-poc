use std::collections::{HashMap, HashSet, VecDeque};

use uuid::Uuid;

use crate::protocol::{SettlementReceiptSnapshot, SettlementSnapshot};

#[derive(Debug, Default)]
pub struct SettlementLedger {
    pending_job_ids: HashSet<Uuid>,
    confirmed_job_ids: HashSet<Uuid>,
    confirmed: VecDeque<SettlementReceiptSnapshot>,
    ownership: HashMap<String, SettlementReceiptSnapshot>,
}

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
