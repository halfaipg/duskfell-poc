use crate::protocol::ResourceKind;

use super::constants::INVENTORY_COMPOST_SPORE_AMOUNT;
use super::lifecycle::inventory_item_lifecycle_snapshot;
use super::model::{
    InventoryCompostCandidate, InventoryCompostOutput, InventoryItemKind, PlayerInventory,
};

impl PlayerInventory {
    pub(in crate::sim) fn shed_compost_spores(&mut self) -> Option<InventoryCompostOutput> {
        let candidate = self.compost_spore_candidate()?;
        let output_total =
            self.add_resource(ResourceKind::Spores, INVENTORY_COMPOST_SPORE_AMOUNT)?;
        Some(InventoryCompostOutput {
            item: candidate.item,
            item_stage: candidate.item_stage,
            output_resource: ResourceKind::Spores,
            output_amount: INVENTORY_COMPOST_SPORE_AMOUNT,
            output_total,
        })
    }

    pub(in crate::sim) fn compost_spore_candidate(&self) -> Option<InventoryCompostCandidate> {
        self.stacks
            .iter()
            .filter(|stack| stack.quantity > 0)
            .find_map(|stack| match stack.item {
                InventoryItemKind::Crafted(_) => {
                    let lifecycle = inventory_item_lifecycle_snapshot(stack);
                    if lifecycle.compostable && lifecycle.decay >= 0.72 {
                        Some(InventoryCompostCandidate {
                            item: stack.item,
                            item_stage: lifecycle.stage,
                        })
                    } else {
                        None
                    }
                }
                InventoryItemKind::Resource(_) => None,
            })
    }
}
