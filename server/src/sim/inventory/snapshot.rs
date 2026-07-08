use crate::protocol::{InventoryItemSnapshot, InventorySnapshot};

use super::labels::{inventory_item_id, inventory_item_label};
use super::lifecycle::inventory_item_lifecycle_snapshot;
use super::model::PlayerInventory;

impl PlayerInventory {
    pub(in crate::sim) fn snapshot(&self) -> InventorySnapshot {
        let mut items = self
            .stacks
            .iter()
            .filter(|stack| stack.quantity > 0)
            .map(|stack| InventoryItemSnapshot {
                item_id: inventory_item_id(stack.item).to_string(),
                label: inventory_item_label(stack.item).to_string(),
                quantity: stack.quantity,
                lifecycle: Some(inventory_item_lifecycle_snapshot(stack)),
            })
            .collect::<Vec<_>>();
        items.sort_by(|a, b| a.item_id.cmp(&b.item_id));
        InventorySnapshot {
            capacity_slots: self.capacity_slots,
            items,
        }
    }
}
