use crate::protocol::ResourceKind;

use super::model::{CraftedItemKind, InventoryItemKind};

pub(in crate::sim) fn resource_item_id(resource: ResourceKind) -> &'static str {
    match resource {
        ResourceKind::Wood => "wood",
        ResourceKind::Ore => "ore",
        ResourceKind::Stone => "stone",
        ResourceKind::Charge => "charge",
        ResourceKind::Deadwood => "deadwood",
        ResourceKind::Fiber => "fiber",
        ResourceKind::Mycelium => "mycelium",
        ResourceKind::Spores => "spores",
        ResourceKind::Seed => "seed",
    }
}

pub(in crate::sim) fn resource_label(resource: ResourceKind) -> &'static str {
    match resource {
        ResourceKind::Wood => "Wood",
        ResourceKind::Ore => "Ore",
        ResourceKind::Stone => "Stone",
        ResourceKind::Charge => "Charge",
        ResourceKind::Deadwood => "Deadwood",
        ResourceKind::Fiber => "Fiber",
        ResourceKind::Mycelium => "Mycelium",
        ResourceKind::Spores => "Spores",
        ResourceKind::Seed => "Seed",
    }
}

pub(in crate::sim) fn crafted_item_id(item: CraftedItemKind) -> &'static str {
    match item {
        CraftedItemKind::TrailKit => "trail-kit",
    }
}

pub(in crate::sim) fn crafted_item_label(item: CraftedItemKind) -> &'static str {
    match item {
        CraftedItemKind::TrailKit => "Trail Kit",
    }
}

pub(in crate::sim) fn inventory_item_id(item: InventoryItemKind) -> &'static str {
    match item {
        InventoryItemKind::Resource(resource) => resource_item_id(resource),
        InventoryItemKind::Crafted(item) => crafted_item_id(item),
    }
}

pub(in crate::sim) fn inventory_item_label(item: InventoryItemKind) -> &'static str {
    match item {
        InventoryItemKind::Resource(resource) => resource_label(resource),
        InventoryItemKind::Crafted(item) => crafted_item_label(item),
    }
}
