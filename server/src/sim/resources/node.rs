use crate::protocol::{ObjectLifecycleSnapshot, ObjectResourceSnapshot, ResourceKind};

use crate::sim::{
    lifecycle_snapshot, lifecycle_years_per_second, LifecycleFamily, ResourceNodeChangedEvent,
    MAX_LIFECYCLE_AGE_YEARS,
};

#[derive(Debug, Clone)]
pub(in crate::sim) struct ResourceNode {
    pub(in crate::sim) resource: ResourceKind,
    pub(in crate::sim) amount: u32,
    pub(in crate::sim) max_amount: u32,
    pub(in crate::sim) regen_per_second: f32,
    pub(in crate::sim) regen_progress: f32,
    pub(in crate::sim) lifecycle_family: LifecycleFamily,
    pub(in crate::sim) stage_override: Option<&'static str>,
    pub(in crate::sim) species: Option<&'static str>,
    pub(in crate::sim) age_years: Option<u32>,
    pub(in crate::sim) age_progress_years: f32,
    pub(in crate::sim) base_health: f32,
}

impl ResourceNode {
    pub(in crate::sim) fn harvest(&mut self, amount: u32) -> Option<u32> {
        if self.amount == 0 {
            return None;
        }
        let harvested = self.amount.min(amount);
        self.amount -= harvested;
        Some(harvested)
    }

    pub(in crate::sim) fn restore(&mut self, amount: u32) {
        self.amount = self.amount.saturating_add(amount).min(self.max_amount);
    }

    pub(in crate::sim) fn feed(&mut self, amount: u32) -> Option<u32> {
        if self.amount >= self.max_amount || amount == 0 {
            return None;
        }
        self.restore(amount);
        Some(self.amount)
    }

    pub(in crate::sim) fn feed_with_delta(&mut self, amount: u32) -> Option<(u32, u32)> {
        if self.amount >= self.max_amount || amount == 0 {
            return None;
        }
        let before = self.amount;
        self.restore(amount);
        let added = self.amount.saturating_sub(before);
        if added == 0 {
            return None;
        }
        Some((self.amount, added))
    }

    pub(in crate::sim) fn regenerate(&mut self, dt: f32) -> bool {
        if self.amount >= self.max_amount || self.regen_per_second <= 0.0 {
            return false;
        }
        let before = self.amount;
        self.regen_progress += self.regen_per_second * dt.max(0.0);
        while self.regen_progress >= 1.0 && self.amount < self.max_amount {
            self.amount += 1;
            self.regen_progress -= 1.0;
        }
        if self.amount >= self.max_amount {
            self.regen_progress = 0.0;
        }
        self.amount != before
    }

    pub(in crate::sim) fn advance_lifecycle_age(&mut self, dt: f32) {
        let Some(age_years) = self.age_years.as_mut() else {
            return;
        };
        if *age_years >= MAX_LIFECYCLE_AGE_YEARS {
            self.age_progress_years = 0.0;
            return;
        }

        self.age_progress_years += lifecycle_years_per_second(self.lifecycle_family) * dt.max(0.0);
        while self.age_progress_years >= 1.0 && *age_years < MAX_LIFECYCLE_AGE_YEARS {
            *age_years += 1;
            self.age_progress_years -= 1.0;
        }
    }

    pub(in crate::sim) fn changed_event(&self, object_id: &str) -> ResourceNodeChangedEvent {
        ResourceNodeChangedEvent {
            object_id: object_id.to_string(),
            resource: self.resource,
            amount: self.amount,
            max_amount: self.max_amount,
        }
    }

    pub(in crate::sim) fn resource_snapshot(&self) -> ObjectResourceSnapshot {
        ObjectResourceSnapshot {
            kind: self.resource,
            amount: self.amount,
            max_amount: self.max_amount,
        }
    }

    pub(in crate::sim) fn lifecycle_snapshot(&self) -> ObjectLifecycleSnapshot {
        let fullness = if self.max_amount == 0 {
            0.0
        } else {
            self.amount as f32 / self.max_amount as f32
        }
        .clamp(0.0, 1.0);
        lifecycle_snapshot(
            self.lifecycle_family,
            self.stage_override,
            self.species,
            self.age_years,
            self.base_health,
            fullness,
        )
    }
}
