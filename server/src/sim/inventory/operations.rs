use crate::protocol::ResourceKind;

use super::constants::{INVENTORY_STACK_LIMIT, MYCELIUM_FEED_AMOUNT};
use super::lifecycle::inventory_item_lifecycle_snapshot;
use super::model::{CraftedItemKind, InventoryItemKind, InventoryStack, PlayerInventory};
use crate::sim::MAX_LIFECYCLE_AGE_YEARS;

impl PlayerInventory {
    pub(in crate::sim) fn add_resource(
        &mut self,
        resource: ResourceKind,
        amount: u32,
    ) -> Option<u32> {
        self.add_item(InventoryItemKind::Resource(resource), amount)
    }

    pub(in crate::sim) fn add_item(&mut self, item: InventoryItemKind, amount: u32) -> Option<u32> {
        let stack = match self.stacks.iter_mut().find(|stack| stack.item == item) {
            Some(stack) => stack,
            None => {
                if self.stacks.len() >= usize::from(self.capacity_slots) {
                    return None;
                }
                self.stacks.push(InventoryStack {
                    item,
                    quantity: 0,
                    age_years: 0,
                    age_progress_years: 0.0,
                });
                self.stacks.last_mut()?
            }
        };

        let before = stack.quantity;
        stack.quantity = stack
            .quantity
            .saturating_add(amount)
            .min(INVENTORY_STACK_LIMIT);
        if stack.quantity == before {
            return None;
        }
        Some(stack.quantity)
    }

    pub(in crate::sim) fn resource_total(&self, resource: ResourceKind) -> u32 {
        self.stacks
            .iter()
            .find(|stack| stack.item == InventoryItemKind::Resource(resource))
            .map(|stack| stack.quantity)
            .unwrap_or(0)
    }

    pub(in crate::sim) fn can_consume_resources(
        &self,
        requirements: &[(ResourceKind, u32)],
    ) -> bool {
        requirements
            .iter()
            .all(|(resource, amount)| self.resource_total(*resource) >= *amount)
    }

    pub(in crate::sim) fn first_available_resource(
        &self,
        resources: &[ResourceKind],
    ) -> Option<ResourceKind> {
        resources
            .iter()
            .copied()
            .find(|resource| self.resource_total(*resource) >= MYCELIUM_FEED_AMOUNT)
    }

    pub(in crate::sim) fn item_total(&self, item: CraftedItemKind) -> u32 {
        self.stacks
            .iter()
            .find(|stack| stack.item == InventoryItemKind::Crafted(item))
            .map(|stack| stack.quantity)
            .unwrap_or(0)
    }

    pub(in crate::sim) fn first_available_item(
        &self,
        items: &[CraftedItemKind],
    ) -> Option<CraftedItemKind> {
        items
            .iter()
            .copied()
            .find(|item| self.item_total(*item) >= MYCELIUM_FEED_AMOUNT)
    }

    pub(in crate::sim) fn item_decay(&self, item: CraftedItemKind) -> Option<f32> {
        self.stacks
            .iter()
            .find(|stack| stack.item == InventoryItemKind::Crafted(item) && stack.quantity > 0)
            .map(|stack| inventory_item_lifecycle_snapshot(stack).decay)
    }

    pub(in crate::sim) fn consume_resource(&mut self, resource: ResourceKind, amount: u32) -> bool {
        self.consume_resources(&[(resource, amount)])
    }

    pub(in crate::sim) fn consume_item(&mut self, item: CraftedItemKind, amount: u32) -> bool {
        if self.item_total(item) < amount {
            return false;
        }
        if let Some(stack) = self
            .stacks
            .iter_mut()
            .find(|stack| stack.item == InventoryItemKind::Crafted(item))
        {
            stack.quantity = stack.quantity.saturating_sub(amount);
        }
        self.stacks.retain(|stack| stack.quantity > 0);
        true
    }

    pub(in crate::sim) fn consume_resources(
        &mut self,
        requirements: &[(ResourceKind, u32)],
    ) -> bool {
        if !self.can_consume_resources(requirements) {
            return false;
        }

        for (resource, amount) in requirements {
            if let Some(stack) = self
                .stacks
                .iter_mut()
                .find(|stack| stack.item == InventoryItemKind::Resource(*resource))
            {
                stack.quantity = stack.quantity.saturating_sub(*amount);
            }
        }
        self.stacks.retain(|stack| stack.quantity > 0);
        true
    }

    pub(in crate::sim) fn advance_lifecycles(&mut self, dt: f32) {
        for stack in &mut self.stacks {
            stack.age_progress_years += dt.max(0.0);
            while stack.age_progress_years >= 1.0 {
                stack.age_years = stack
                    .age_years
                    .saturating_add(1)
                    .min(MAX_LIFECYCLE_AGE_YEARS);
                stack.age_progress_years -= 1.0;
            }
        }
    }
}
