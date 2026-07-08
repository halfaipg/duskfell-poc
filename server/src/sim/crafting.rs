use bevy_ecs::prelude::Entity;

use crate::protocol::PlayerId;

use super::inventory::{inventory_item_id, CraftedItemKind, InventoryItemKind, TRAIL_KIT_RECIPE};
use super::movement::distance;
use super::{Player, Position, SimWorld, INTERACT_RADIUS};

#[derive(Debug, Clone)]
pub struct ItemCraftedEvent {
    pub player_id: PlayerId,
    pub object_id: String,
    pub item_id: String,
    pub amount: u32,
    pub total: u32,
}

impl SimWorld {
    pub(super) fn try_craft_item(
        &mut self,
        player_id: PlayerId,
        player_entity: Entity,
    ) -> Option<ItemCraftedEvent> {
        let player_position = *self.world.get::<Position>(player_entity)?;
        let forge_position = self.object_position("field-forge")?;
        if distance(player_position, forge_position) > INTERACT_RADIUS {
            return None;
        }

        let crafted_item = InventoryItemKind::Crafted(CraftedItemKind::TrailKit);
        let mut player = self.world.get_mut::<Player>(player_entity)?;
        if !player.inventory.consume_resources(TRAIL_KIT_RECIPE) {
            return None;
        }
        let total = match player.inventory.add_item(crafted_item, 1) {
            Some(total) => total,
            None => {
                for (resource, amount) in TRAIL_KIT_RECIPE {
                    let _ = player.inventory.add_resource(*resource, *amount);
                }
                return None;
            }
        };

        Some(ItemCraftedEvent {
            player_id,
            object_id: "field-forge".to_string(),
            item_id: inventory_item_id(crafted_item).to_string(),
            amount: 1,
            total,
        })
    }
}
