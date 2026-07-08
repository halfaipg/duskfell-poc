use bevy_ecs::prelude::Entity;
use uuid::Uuid;

use crate::protocol::{PlayerId, ResourceKind};
use crate::settlement::SettlementJob;

use super::inventory::{
    compost_feed_amount, crafted_item_id, crafted_item_label, InventoryItemKind,
    MYCELIUM_FEED_AMOUNT, MYCELIUM_FEED_ITEMS, MYCELIUM_FEED_RESOURCES,
};
use super::lifecycle::LifecycleFamily;
use super::movement::distance;
use super::{
    point_from_position, GatherTarget, Player, Position, ResourceNodeChangedEvent, SimWorld,
    WorldObject, INTERACT_RADIUS, RESOURCE_GATHER_AMOUNT,
};

#[derive(Debug, Clone)]
pub struct ResourceGatheredEvent {
    pub player_id: PlayerId,
    pub object_id: String,
    pub resource: ResourceKind,
    pub amount: u32,
    pub total: u32,
}

#[derive(Debug, Clone)]
pub struct ResourceFedEvent {
    pub player_id: PlayerId,
    pub object_id: String,
    pub input_resource: ResourceKind,
    pub input_amount: u32,
    pub input_total: u32,
    pub output_resource: ResourceKind,
    pub output_amount: u32,
    pub output_total: u32,
}

#[derive(Debug, Clone)]
pub struct ItemFedEvent {
    pub player_id: PlayerId,
    pub object_id: String,
    pub item_id: String,
    pub item_label: String,
    pub input_amount: u32,
    pub input_total: u32,
    pub output_resource: ResourceKind,
    pub output_amount: u32,
    pub output_total: u32,
}

impl SimWorld {
    pub(super) fn try_claim_demo_deed(
        &mut self,
        id: PlayerId,
        entity: Entity,
    ) -> Option<SettlementJob> {
        let position = *self.world.get::<Position>(entity)?;
        let registrar_position = self.object_position("registrar")?;
        if distance(position, registrar_position) > INTERACT_RADIUS {
            return None;
        }

        let asset_id = format!("dryrun-deed-{}", &id.to_string()[..8]);
        let mut player = self.world.get_mut::<Player>(entity)?;
        if player.demo_deeds.iter().any(|deed| deed == &asset_id) {
            return None;
        }

        player.demo_deeds.push(asset_id.clone());
        Some(SettlementJob {
            job_id: Uuid::new_v4(),
            player_id: id,
            account_subject: player.account_subject.clone(),
            asset_id,
            reason: "registrar-demo-deed".to_string(),
        })
    }

    pub(super) fn try_gather_resource(
        &mut self,
        player_id: PlayerId,
        player_entity: Entity,
    ) -> Option<(ResourceGatheredEvent, Vec<ResourceNodeChangedEvent>)> {
        let player_position = *self.world.get::<Position>(player_entity)?;
        let target = self.nearest_gatherable(player_position)?;
        let (harvested, node_event, creates_deadwood_fallout) = {
            let mut object = self.world.get_mut::<WorldObject>(target.entity)?;
            let resource_node = object.resource_node.as_mut()?;
            let creates_deadwood_fallout = resource_node.lifecycle_family == LifecycleFamily::Tree
                && resource_node.resource == ResourceKind::Wood;
            let harvested = resource_node.harvest(RESOURCE_GATHER_AMOUNT)?;
            (
                harvested,
                resource_node.changed_event(&target.object_id),
                creates_deadwood_fallout,
            )
        };

        let total = {
            let mut player = self.world.get_mut::<Player>(player_entity)?;
            player.inventory.add_resource(target.resource, harvested)
        };
        let Some(total) = total else {
            if let Some(mut object) = self.world.get_mut::<WorldObject>(target.entity) {
                if let Some(resource_node) = object.resource_node.as_mut() {
                    resource_node.restore(harvested);
                }
            }
            return None;
        };

        let mut node_events = vec![node_event];
        if creates_deadwood_fallout {
            if let Some(fallout_event) = self.add_tree_harvest_fallout(target.position) {
                node_events.push(fallout_event);
            }
        }

        Some((
            ResourceGatheredEvent {
                player_id,
                object_id: target.object_id,
                resource: target.resource,
                amount: harvested,
                total,
            },
            node_events,
        ))
    }

    pub(super) fn try_feed_mycelium(
        &mut self,
        player_id: PlayerId,
        player_entity: Entity,
    ) -> Option<(ResourceFedEvent, ResourceNodeChangedEvent)> {
        let input_resource = {
            let player = self.world.get::<Player>(player_entity)?;
            player
                .inventory
                .first_available_resource(MYCELIUM_FEED_RESOURCES)?
        };

        let player_position = *self.world.get::<Position>(player_entity)?;
        let target = self.nearest_feedable_mycelium(player_position)?;

        let input_total = {
            let mut player = self.world.get_mut::<Player>(player_entity)?;
            if !player
                .inventory
                .consume_resource(input_resource, MYCELIUM_FEED_AMOUNT)
            {
                return None;
            }
            player.inventory.resource_total(input_resource)
        };

        let (output_total, node_event) = {
            let mut object = self.world.get_mut::<WorldObject>(target.entity)?;
            let resource_node = object.resource_node.as_mut()?;
            let output_total = resource_node.feed(MYCELIUM_FEED_AMOUNT)?;
            (output_total, resource_node.changed_event(&target.object_id))
        };

        Some((
            ResourceFedEvent {
                player_id,
                object_id: target.object_id,
                input_resource,
                input_amount: MYCELIUM_FEED_AMOUNT,
                input_total,
                output_resource: target.resource,
                output_amount: MYCELIUM_FEED_AMOUNT,
                output_total,
            },
            node_event,
        ))
    }

    pub(super) fn try_feed_compostable_item(
        &mut self,
        player_id: PlayerId,
        player_entity: Entity,
    ) -> Option<(ItemFedEvent, ResourceNodeChangedEvent)> {
        let (input_item, input_decay) = {
            let player = self.world.get::<Player>(player_entity)?;
            let item = player.inventory.first_available_item(MYCELIUM_FEED_ITEMS)?;
            let decay = player.inventory.item_decay(item).unwrap_or(0.0);
            (item, decay)
        };
        let feed_amount = compost_feed_amount(input_decay);

        let player_position = *self.world.get::<Position>(player_entity)?;
        let target = self.nearest_feedable_mycelium(player_position)?;

        let input_total = {
            let mut player = self.world.get_mut::<Player>(player_entity)?;
            if !player
                .inventory
                .consume_item(input_item, MYCELIUM_FEED_AMOUNT)
            {
                return None;
            }
            player.inventory.item_total(input_item)
        };

        let feed_result = if let Some(mut object) = self.world.get_mut::<WorldObject>(target.entity)
        {
            if let Some(resource_node) = object.resource_node.as_mut() {
                resource_node
                    .feed_with_delta(feed_amount)
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

        let Some((output_total, output_amount, node_event)) = feed_result else {
            if let Some(mut player) = self.world.get_mut::<Player>(player_entity) {
                let _ = player
                    .inventory
                    .add_item(InventoryItemKind::Crafted(input_item), MYCELIUM_FEED_AMOUNT);
            }
            return None;
        };

        Some((
            ItemFedEvent {
                player_id,
                object_id: target.object_id,
                item_id: crafted_item_id(input_item).to_string(),
                item_label: crafted_item_label(input_item).to_string(),
                input_amount: MYCELIUM_FEED_AMOUNT,
                input_total,
                output_resource: target.resource,
                output_amount,
                output_total,
            },
            node_event,
        ))
    }

    fn nearest_gatherable(&self, player_position: Position) -> Option<GatherTarget> {
        self.object_index
            .query_radius(
                point_from_position(player_position),
                INTERACT_RADIUS + self.max_object_radius,
            )
            .into_iter()
            .filter_map(|entity| {
                let object = self.world.get::<WorldObject>(entity)?;
                let position = self.world.get::<Position>(entity)?;
                let resource_node = object.resource_node.as_ref()?;
                if resource_node.amount == 0 {
                    return None;
                }
                let distance = distance(player_position, *position);
                if distance > INTERACT_RADIUS {
                    return None;
                }
                Some(GatherTarget {
                    entity,
                    object_id: object.id.clone(),
                    resource: resource_node.resource,
                    position: *position,
                    distance,
                })
            })
            .min_by(|a, b| a.distance.total_cmp(&b.distance))
    }

    pub(super) fn nearest_feedable_mycelium(
        &self,
        player_position: Position,
    ) -> Option<GatherTarget> {
        self.object_index
            .query_radius(
                point_from_position(player_position),
                INTERACT_RADIUS + self.max_object_radius,
            )
            .into_iter()
            .filter_map(|entity| {
                let object = self.world.get::<WorldObject>(entity)?;
                let position = self.world.get::<Position>(entity)?;
                let resource_node = object.resource_node.as_ref()?;
                if resource_node.lifecycle_family != LifecycleFamily::Mycelium
                    || resource_node.resource != ResourceKind::Mycelium
                    || resource_node.amount >= resource_node.max_amount
                {
                    return None;
                }
                let distance = distance(player_position, *position);
                if distance > INTERACT_RADIUS {
                    return None;
                }
                Some(GatherTarget {
                    entity,
                    object_id: object.id.clone(),
                    resource: resource_node.resource,
                    position: *position,
                    distance,
                })
            })
            .min_by(|a, b| a.distance.total_cmp(&b.distance))
    }

    pub(super) fn object_position(&self, id: &str) -> Option<Position> {
        self.object_entities
            .get(id)
            .and_then(|entity| self.world.get::<Position>(*entity).copied())
    }
}
