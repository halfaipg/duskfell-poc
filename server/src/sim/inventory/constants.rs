use crate::protocol::ResourceKind;

use super::model::CraftedItemKind;

pub(in crate::sim) const MYCELIUM_FEED_AMOUNT: u32 = 1;
pub(in crate::sim) const INVENTORY_COMPOST_SPORE_INTERVAL_TICKS: u64 = 40;
pub(in crate::sim) const INVENTORY_COMPOST_SPORE_AMOUNT: u32 = 1;
pub(in crate::sim) const MYCELIUM_FEED_RESOURCES: &[ResourceKind] = &[
    ResourceKind::Deadwood,
    ResourceKind::Fiber,
    ResourceKind::Seed,
    ResourceKind::Spores,
];
pub(in crate::sim) const MYCELIUM_FEED_ITEMS: &[CraftedItemKind] = &[CraftedItemKind::TrailKit];
pub(in crate::sim) const TRAIL_KIT_RECIPE: &[(ResourceKind, u32)] =
    &[(ResourceKind::Wood, 1), (ResourceKind::Ore, 1)];
pub(in crate::sim) const INVENTORY_CAPACITY_SLOTS: u8 = 8;
pub(in crate::sim) const INVENTORY_STACK_LIMIT: u32 = 999;
