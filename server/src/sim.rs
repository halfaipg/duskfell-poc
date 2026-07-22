use std::collections::HashMap;

use bevy_ecs::prelude::*;

#[cfg(test)]
use crate::content::WorldContent;
#[cfg(test)]
use crate::player_identity::{validate_player_name, PlayerNameError, PLAYER_NAME_MAX_CHARS};
#[cfg(test)]
use crate::protocol::ObjectKind;
use crate::protocol::ResourceKind;
use crate::region_routing::detect_region_handoff;
use crate::spatial::Point;

mod actor_intents;
mod crafting;
mod ecology;
mod interactions;
mod inventory;
mod lifecycle;
mod model;
mod movement;
mod npcs;
mod players;
mod resources;
mod snapshot;
mod spawn;
mod terrain_authority;
#[allow(dead_code)]
mod transfer;
mod world_init;

pub(crate) use self::actor_intents::{ActorId, ActorIntent, ActorIntentError};
#[allow(unused_imports)]
pub use self::crafting::ItemCraftedEvent;
#[cfg(test)]
use self::ecology::{COIL_MYCELIUM_CHARGE_INTERVAL_TICKS, ECOLOGY_DECAY_FEED_INTERVAL_TICKS};
#[allow(unused_imports)]
pub use self::interactions::{ItemFedEvent, ResourceFedEvent, ResourceGatheredEvent};
#[cfg(test)]
use self::inventory::*;
use self::lifecycle::*;
use self::model::{
    axis, movement_scale, point_from_position, GatherTarget, Player, Position, Velocity,
    WorldObject, INTERACT_RADIUS, MAX_LIFECYCLE_AGE_YEARS, OBJECT_SOLID_RADIUS_SCALE,
    PLAYER_COLLISION_RADIUS, PLAYER_SPEED, RESOURCE_GATHER_AMOUNT, SPAWN_PLAYER_SEPARATION,
    SPAWN_SAFE_MARGIN, SPAWN_SLOT_BASE_RADIUS, SPAWN_SLOT_COUNT, SPAWN_SLOT_MAX_RINGS,
    SPAWN_SLOT_RING_STEP,
};
pub use self::model::{
    ItemDecayedEvent, PlayerInput, ResourceNodeChangedEvent, SimTickOutcome, SimWorld,
    INTEREST_RADIUS,
};
use self::movement::*;
use self::resources::*;
pub use self::terrain_authority::TerrainDetailAuthority;
#[cfg(test)]
use self::terrain_authority::{
    TerrainDetailAuthorityBlocker, TerrainDetailAuthorityCollision,
    TerrainDetailAuthorityConsumeRequirement, TerrainDetailAuthorityDecayConsumer,
    TerrainDetailAuthorityLifecycle, TerrainDetailAuthorityResource,
    TerrainDetailAuthorityResourceNode,
};
#[allow(unused_imports)]
pub(crate) use self::transfer::{
    PlayerTransferInventoryStack, PlayerTransferState, TransferStateError,
};

impl SimWorld {
    pub fn tick(&mut self, dt: f32) -> SimTickOutcome {
        self.tick += 1;
        let mut outcome = SimTickOutcome::default();
        self.advance_resource_lifecycles(dt);
        self.advance_inventory_lifecycles(dt);
        let (item_decay_events, item_decay_node_events) = self.shed_inventory_compost_spores();
        outcome.item_decay_events.extend(item_decay_events);
        outcome.resource_node_events.extend(item_decay_node_events);
        outcome
            .resource_node_events
            .extend(self.regenerate_resource_nodes(dt));
        outcome
            .resource_node_events
            .extend(self.decay_deadwood_into_mycelium());
        outcome
            .resource_node_events
            .extend(self.charge_mycelium_from_field_coils());
        let movement_blockers = self.movement_blockers();

        let mut player_movement = self.world.query::<(&Player, &mut Velocity)>();
        for (player, mut velocity) in player_movement.iter_mut(&mut self.world) {
            let input = self.inputs.get(&player.id).copied().unwrap_or_default();
            let horizontal = axis(input.left, input.right);
            let vertical = axis(input.up, input.down);
            let scale = movement_scale(horizontal, vertical);
            velocity.x = horizontal * PLAYER_SPEED * scale;
            velocity.y = vertical * PLAYER_SPEED * scale;
        }

        let mut movers = self
            .world
            .query::<(Entity, &Player, &mut Position, &Velocity)>();
        for (entity, player, mut position, velocity) in movers.iter_mut(&mut self.world) {
            let intended_x = position.x + velocity.x * dt;
            let intended_y = position.y + velocity.y * dt;
            if let Some(intent) = detect_region_handoff(
                self.map.region.as_ref(),
                player.id,
                self.map.width,
                self.map.height,
                self.map.terrain_snapshot.units_per_tile,
                intended_x,
                intended_y,
            ) {
                if self.region_handoff_latches.insert(player.id) {
                    outcome.region_handoff_intents.push(intent);
                }
            } else {
                self.region_handoff_latches.remove(&player.id);
            }
            let candidate = Position {
                x: intended_x.clamp(28.0, self.map.width - 28.0),
                y: intended_y.clamp(28.0, self.map.height - 28.0),
            };
            if player_step_allowed(&self.terrain, &movement_blockers, *position, candidate) {
                position.x = candidate.x;
                position.y = candidate.y;
            } else if player_step_allowed(
                &self.terrain,
                &movement_blockers,
                *position,
                Position {
                    x: candidate.x,
                    y: position.y,
                },
            ) {
                position.x = candidate.x;
            } else if player_step_allowed(
                &self.terrain,
                &movement_blockers,
                *position,
                Position {
                    x: position.x,
                    y: candidate.y,
                },
            ) {
                position.y = candidate.y;
            }
            self.player_index.insert_or_update(
                entity,
                Point {
                    x: position.x,
                    y: position.y,
                },
            );
        }

        let mut interaction_attempts = Vec::new();
        for (&id, &entity) in &self.players {
            let input = self.inputs.get(&id).copied().unwrap_or_default();
            let was_interacting = self.interact_latches.get(&id).copied().unwrap_or(false);
            self.interact_latches.insert(id, input.interact);

            if input.interact && !was_interacting {
                interaction_attempts.push((id, entity));
            }
        }

        for (id, entity) in interaction_attempts {
            if let Some(job) = self.try_claim_demo_deed(id, entity) {
                outcome.settlement_jobs.push(job);
            } else if let Some(event) = self.try_craft_item(id, entity) {
                outcome.crafting_events.push(event);
            } else if let Some((feed_event, node_event)) = self.try_feed_mycelium(id, entity) {
                outcome.resource_feed_events.push(feed_event);
                outcome.resource_node_events.push(node_event);
            } else if let Some((feed_event, node_event)) =
                self.try_feed_compostable_item(id, entity)
            {
                outcome.item_feed_events.push(feed_event);
                outcome.resource_node_events.push(node_event);
            } else if let Some((resource_event, node_events)) = self.try_gather_resource(id, entity)
            {
                outcome.resource_events.push(resource_event);
                outcome.resource_node_events.extend(node_events);
            }
        }

        outcome
    }

    pub fn tick_count(&self) -> u64 {
        self.tick
    }

    pub fn player_count(&self) -> usize {
        self.players.len()
    }

    pub fn apply_resource_node_replay(
        &mut self,
        states: &HashMap<String, (ResourceKind, u32)>,
    ) -> usize {
        let mut applied = 0;
        for (object_id, (resource, amount)) in states {
            let Some(entity) = self.object_entities.get(object_id).copied() else {
                continue;
            };
            let Some(mut object) = self.world.get_mut::<WorldObject>(entity) else {
                continue;
            };
            let Some(resource_node) = object.resource_node.as_mut() else {
                continue;
            };
            if resource_node.resource != *resource {
                continue;
            }
            resource_node.amount = (*amount).min(resource_node.max_amount);
            resource_node.regen_progress = 0.0;
            applied += 1;
        }
        applied
    }

    fn regenerate_resource_nodes(&mut self, dt: f32) -> Vec<ResourceNodeChangedEvent> {
        let mut events = Vec::new();
        let mut query = self.world.query::<&mut WorldObject>();
        for mut object in query.iter_mut(&mut self.world) {
            let object_id = object.id.clone();
            if let Some(resource_node) = object.resource_node.as_mut() {
                if resource_node.regenerate(dt) {
                    events.push(resource_node.changed_event(&object_id));
                }
            }
        }
        events
    }

    fn advance_resource_lifecycles(&mut self, dt: f32) {
        let mut query = self.world.query::<&mut WorldObject>();
        for mut object in query.iter_mut(&mut self.world) {
            if let Some(resource_node) = object.resource_node.as_mut() {
                resource_node.advance_lifecycle_age(dt);
            }
        }
    }

    fn advance_inventory_lifecycles(&mut self, dt: f32) {
        let mut query = self.world.query::<&mut Player>();
        for mut player in query.iter_mut(&mut self.world) {
            player.inventory.advance_lifecycles(dt);
        }
    }
}

#[cfg(test)]
mod tests;
