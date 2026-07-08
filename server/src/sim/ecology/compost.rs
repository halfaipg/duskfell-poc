use bevy_ecs::prelude::Entity;

use crate::sim::inventory::{
    inventory_item_id, inventory_item_label, INVENTORY_COMPOST_SPORE_AMOUNT,
    INVENTORY_COMPOST_SPORE_INTERVAL_TICKS,
};
use crate::sim::{ItemDecayedEvent, Player, ResourceNodeChangedEvent, SimWorld, WorldObject};

impl SimWorld {
    pub(in crate::sim) fn shed_inventory_compost_spores(
        &mut self,
    ) -> (Vec<ItemDecayedEvent>, Vec<ResourceNodeChangedEvent>) {
        if self.tick % INVENTORY_COMPOST_SPORE_INTERVAL_TICKS != 0 {
            return (Vec::new(), Vec::new());
        }

        let mut events = Vec::new();
        let mut node_events = Vec::new();
        let mut query = self
            .world
            .query::<(Entity, &Player, &crate::sim::Position)>();
        let players = query
            .iter(&self.world)
            .map(|(entity, player, position)| (entity, player.id, *position))
            .collect::<Vec<_>>();

        for (entity, player_id, position) in players {
            let Some(candidate) = self
                .world
                .get::<Player>(entity)
                .and_then(|player| player.inventory.compost_spore_candidate())
            else {
                continue;
            };

            if let Some(target) = self.nearest_feedable_mycelium(position) {
                let feed_result =
                    if let Some(mut object) = self.world.get_mut::<WorldObject>(target.entity) {
                        if let Some(resource_node) = object.resource_node.as_mut() {
                            resource_node
                                .feed_with_delta(INVENTORY_COMPOST_SPORE_AMOUNT)
                                .map(|(output_total, output_amount)| {
                                    (
                                        output_total,
                                        output_amount,
                                        resource_node.changed_event(&target.object_id),
                                    )
                                })
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                if let Some((output_total, output_amount, node_event)) = feed_result {
                    events.push(ItemDecayedEvent {
                        player_id,
                        target_object_id: Some(target.object_id),
                        item_id: inventory_item_id(candidate.item).to_string(),
                        item_label: inventory_item_label(candidate.item).to_string(),
                        item_stage: candidate.item_stage,
                        output_resource: target.resource,
                        output_amount,
                        output_total,
                    });
                    node_events.push(node_event);
                    continue;
                }
            }

            let Some(output) = self
                .world
                .get_mut::<Player>(entity)
                .and_then(|mut player| player.inventory.shed_compost_spores())
            else {
                continue;
            };
            events.push(ItemDecayedEvent {
                player_id,
                target_object_id: None,
                item_id: inventory_item_id(output.item).to_string(),
                item_label: inventory_item_label(output.item).to_string(),
                item_stage: output.item_stage,
                output_resource: output.output_resource,
                output_amount: output.output_amount,
                output_total: output.output_total,
            });
        }
        (events, node_events)
    }
}
