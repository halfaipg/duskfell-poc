use crate::protocol::ResourceKind;

use super::constants::INVENTORY_CAPACITY_SLOTS;

#[derive(Debug, Clone)]
pub(in crate::sim) struct PlayerInventory {
    pub(in crate::sim) capacity_slots: u8,
    pub(in crate::sim) stacks: Vec<InventoryStack>,
}

#[derive(Debug, Clone)]
pub(in crate::sim) struct InventoryStack {
    pub(in crate::sim) item: InventoryItemKind,
    pub(in crate::sim) quantity: u32,
    pub(in crate::sim) age_years: u32,
    pub(in crate::sim) age_progress_years: f32,
}

#[derive(Debug, Clone)]
pub(in crate::sim) struct InventoryCompostOutput {
    pub(in crate::sim) item: InventoryItemKind,
    pub(in crate::sim) item_stage: String,
    pub(in crate::sim) output_resource: ResourceKind,
    pub(in crate::sim) output_amount: u32,
    pub(in crate::sim) output_total: u32,
}

#[derive(Debug, Clone)]
pub(in crate::sim) struct InventoryCompostCandidate {
    pub(in crate::sim) item: InventoryItemKind,
    pub(in crate::sim) item_stage: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::sim) enum InventoryItemKind {
    Resource(ResourceKind),
    Crafted(CraftedItemKind),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::sim) enum CraftedItemKind {
    TrailKit,
}

impl Default for PlayerInventory {
    fn default() -> Self {
        Self {
            capacity_slots: INVENTORY_CAPACITY_SLOTS,
            stacks: Vec::new(),
        }
    }
}
