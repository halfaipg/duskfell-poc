use crate::protocol::{InventoryItemLifecycleSnapshot, ResourceKind};

use super::constants::{MYCELIUM_FEED_AMOUNT, MYCELIUM_FEED_ITEMS, MYCELIUM_FEED_RESOURCES};
use super::model::{CraftedItemKind, InventoryItemKind, InventoryStack};

pub(in crate::sim) fn inventory_item_lifecycle_snapshot(
    stack: &InventoryStack,
) -> InventoryItemLifecycleSnapshot {
    let profile = inventory_item_lifecycle_profile(stack.item);
    let age_pressure = (stack.age_years as f32 / profile.pressure_years).clamp(0.0, 1.0);
    let decay = (profile.base_decay + age_pressure * profile.decay_wear).clamp(0.0, 1.0);
    InventoryItemLifecycleSnapshot {
        family: profile.family.to_string(),
        stage: inventory_item_lifecycle_stage(decay).to_string(),
        age_years: stack.age_years,
        health: (profile.base_health * (1.0 - age_pressure * profile.health_wear)).clamp(0.0, 1.0),
        decay,
        compostable: inventory_item_is_compostable(stack.item),
    }
}

#[derive(Debug, Clone, Copy)]
struct InventoryItemLifecycleProfile {
    family: &'static str,
    pressure_years: f32,
    base_health: f32,
    health_wear: f32,
    base_decay: f32,
    decay_wear: f32,
}

fn inventory_item_lifecycle_profile(item: InventoryItemKind) -> InventoryItemLifecycleProfile {
    match item {
        InventoryItemKind::Crafted(CraftedItemKind::TrailKit) => InventoryItemLifecycleProfile {
            family: "crafted",
            pressure_years: 8.0,
            base_health: 0.86,
            health_wear: 0.58,
            base_decay: 0.08,
            decay_wear: 0.82,
        },
        InventoryItemKind::Resource(ResourceKind::Deadwood) => InventoryItemLifecycleProfile {
            family: "deadwood",
            pressure_years: 18.0,
            base_health: 0.36,
            health_wear: 0.55,
            base_decay: 0.48,
            decay_wear: 0.42,
        },
        InventoryItemKind::Resource(ResourceKind::Fiber)
        | InventoryItemKind::Resource(ResourceKind::Spores)
        | InventoryItemKind::Resource(ResourceKind::Seed) => InventoryItemLifecycleProfile {
            family: "organic",
            pressure_years: 14.0,
            base_health: 0.72,
            health_wear: 0.48,
            base_decay: 0.2,
            decay_wear: 0.68,
        },
        InventoryItemKind::Resource(ResourceKind::Wood) => InventoryItemLifecycleProfile {
            family: "wood",
            pressure_years: 42.0,
            base_health: 0.88,
            health_wear: 0.34,
            base_decay: 0.12,
            decay_wear: 0.5,
        },
        InventoryItemKind::Resource(ResourceKind::Mycelium) => InventoryItemLifecycleProfile {
            family: "mycelium",
            pressure_years: 12.0,
            base_health: 0.9,
            health_wear: 0.12,
            base_decay: 0.18,
            decay_wear: 0.28,
        },
        InventoryItemKind::Resource(ResourceKind::Ore)
        | InventoryItemKind::Resource(ResourceKind::Stone) => InventoryItemLifecycleProfile {
            family: "mineral",
            pressure_years: 100_000.0,
            base_health: 0.96,
            health_wear: 0.18,
            base_decay: 0.02,
            decay_wear: 0.36,
        },
        InventoryItemKind::Resource(ResourceKind::Charge) => InventoryItemLifecycleProfile {
            family: "charge",
            pressure_years: 28.0,
            base_health: 0.78,
            health_wear: 0.4,
            base_decay: 0.1,
            decay_wear: 0.44,
        },
    }
}

fn inventory_item_lifecycle_stage(decay: f32) -> &'static str {
    if decay >= 0.72 {
        "composting"
    } else if decay >= 0.44 {
        "decaying"
    } else if decay >= 0.18 {
        "weathered"
    } else {
        "fresh"
    }
}

pub(in crate::sim) fn compost_feed_amount(decay: f32) -> u32 {
    if decay >= 0.72 {
        3
    } else if decay >= 0.44 {
        2
    } else {
        MYCELIUM_FEED_AMOUNT
    }
}

fn inventory_item_is_compostable(item: InventoryItemKind) -> bool {
    match item {
        InventoryItemKind::Resource(resource) => MYCELIUM_FEED_RESOURCES.contains(&resource),
        InventoryItemKind::Crafted(item) => MYCELIUM_FEED_ITEMS.contains(&item),
    }
}
