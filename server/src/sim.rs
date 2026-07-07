use std::collections::HashMap;
use std::f32::consts::FRAC_1_SQRT_2;

use bevy_ecs::prelude::*;
use serde::Deserialize;
use uuid::Uuid;

use crate::content::WorldContent;
use crate::protocol::{
    InventoryItemSnapshot, InventorySnapshot, MapSnapshot, ObjectKind, ObjectLifecycleSnapshot,
    ObjectResourceSnapshot, ObjectSnapshot, PlayerId, PlayerSnapshot, ResourceKind,
    ResourceSnapshot, SettlementSnapshot, TerrainSnapshot, WorldSnapshot,
};
use crate::settlement::SettlementJob;
use crate::spatial::{Point, SpatialIndex};
use crate::terrain::TerrainAuthority;

const PLAYER_SPEED: f32 = 220.0;
const PLAYER_COLLISION_RADIUS: f32 = 18.0;
const OBJECT_SOLID_RADIUS_SCALE: f32 = 0.45;
const INTERACT_RADIUS: f32 = 64.0;
const RESOURCE_GATHER_AMOUNT: u32 = 1;
const TREE_HARVEST_FALLOUT_AMOUNT: u32 = 1;
const TREE_HARVEST_FALLOUT_RADIUS: f32 = 140.0;
const MYCELIUM_FEED_AMOUNT: u32 = 1;
const MYCELIUM_FEED_RESOURCES: &[ResourceKind] = &[
    ResourceKind::Deadwood,
    ResourceKind::Fiber,
    ResourceKind::Seed,
    ResourceKind::Spores,
];
const ECOLOGY_DECAY_FEED_INTERVAL_TICKS: u64 = 20;
const ECOLOGY_DECAY_FEED_RADIUS: f32 = 96.0;
const COIL_MYCELIUM_CHARGE_INTERVAL_TICKS: u64 = 30;
const COIL_MYCELIUM_CHARGE_RADIUS: f32 = 120.0;
const TRAIL_KIT_RECIPE: &[(ResourceKind, u32)] = &[(ResourceKind::Wood, 1), (ResourceKind::Ore, 1)];
const INVENTORY_CAPACITY_SLOTS: u8 = 8;
const INVENTORY_STACK_LIMIT: u32 = 999;
pub const INTEREST_RADIUS: f32 = 520.0;
pub const PLAYER_NAME_MAX_CHARS: usize = 20;
const SPATIAL_CELL_SIZE: f32 = 256.0;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainDetailAuthority {
    schema_version: String,
    projection: String,
    profile: String,
    units_per_tile: u32,
    blockers: Vec<TerrainDetailAuthorityBlocker>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerrainDetailAuthorityBlocker {
    id: String,
    x: f32,
    y: f32,
    collision: TerrainDetailAuthorityCollision,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerrainDetailAuthorityCollision {
    blocks_movement: bool,
    shape: String,
    width_tiles: f32,
    height_tiles: f32,
}

#[derive(Component, Debug, Clone, Copy)]
struct Position {
    x: f32,
    y: f32,
}

#[derive(Component, Debug, Clone, Copy, Default)]
struct Velocity {
    x: f32,
    y: f32,
}

#[derive(Component, Debug, Clone)]
struct Player {
    id: PlayerId,
    account_subject: Option<String>,
    name: String,
    color: String,
    demo_deeds: Vec<String>,
    inventory: PlayerInventory,
}

#[derive(Debug, Clone)]
struct PlayerInventory {
    capacity_slots: u8,
    stacks: Vec<InventoryStack>,
}

#[derive(Debug, Clone)]
struct InventoryStack {
    item: InventoryItemKind,
    quantity: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InventoryItemKind {
    Resource(ResourceKind),
    Crafted(CraftedItemKind),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CraftedItemKind {
    TrailKit,
}

impl Default for PlayerInventory {
    fn default() -> Self {
        Self {
            capacity_slots: INVENTORY_CAPACITY_SLOTS,
            stacks: Vec::new(),
        }
    }
}

impl PlayerInventory {
    fn add_resource(&mut self, resource: ResourceKind, amount: u32) -> Option<u32> {
        self.add_item(InventoryItemKind::Resource(resource), amount)
    }

    fn add_item(&mut self, item: InventoryItemKind, amount: u32) -> Option<u32> {
        let stack = match self.stacks.iter_mut().find(|stack| stack.item == item) {
            Some(stack) => stack,
            None => {
                if self.stacks.len() >= usize::from(self.capacity_slots) {
                    return None;
                }
                self.stacks.push(InventoryStack { item, quantity: 0 });
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

    fn resource_total(&self, resource: ResourceKind) -> u32 {
        self.stacks
            .iter()
            .find(|stack| stack.item == InventoryItemKind::Resource(resource))
            .map(|stack| stack.quantity)
            .unwrap_or(0)
    }

    fn can_consume_resources(&self, requirements: &[(ResourceKind, u32)]) -> bool {
        requirements
            .iter()
            .all(|(resource, amount)| self.resource_total(*resource) >= *amount)
    }

    fn first_available_resource(&self, resources: &[ResourceKind]) -> Option<ResourceKind> {
        resources
            .iter()
            .copied()
            .find(|resource| self.resource_total(*resource) >= MYCELIUM_FEED_AMOUNT)
    }

    fn consume_resource(&mut self, resource: ResourceKind, amount: u32) -> bool {
        self.consume_resources(&[(resource, amount)])
    }

    fn consume_resources(&mut self, requirements: &[(ResourceKind, u32)]) -> bool {
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

    fn snapshot(&self) -> InventorySnapshot {
        let mut items = self
            .stacks
            .iter()
            .filter(|stack| stack.quantity > 0)
            .map(|stack| InventoryItemSnapshot {
                item_id: inventory_item_id(stack.item).to_string(),
                label: inventory_item_label(stack.item).to_string(),
                quantity: stack.quantity,
            })
            .collect::<Vec<_>>();
        items.sort_by(|a, b| a.item_id.cmp(&b.item_id));
        InventorySnapshot {
            capacity_slots: self.capacity_slots,
            items,
        }
    }
}

#[derive(Component, Debug, Clone)]
struct WorldObject {
    id: String,
    kind: ObjectKind,
    label: String,
    radius: f32,
    resource_node: Option<ResourceNode>,
}

#[derive(Debug, Clone)]
struct ResourceNode {
    resource: ResourceKind,
    amount: u32,
    max_amount: u32,
    regen_per_second: f32,
    regen_progress: f32,
    lifecycle_family: LifecycleFamily,
    stage_override: Option<&'static str>,
    species: Option<&'static str>,
    age_years: Option<u32>,
    base_health: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LifecycleFamily {
    Tree,
    Deadwood,
    Mineral,
    Mycelium,
    Machine,
}

impl LifecycleFamily {
    fn snapshot_family(self) -> &'static str {
        match self {
            LifecycleFamily::Tree => "tree",
            LifecycleFamily::Deadwood => "deadwood",
            LifecycleFamily::Mineral => "mineral",
            LifecycleFamily::Mycelium => "mycelium",
            LifecycleFamily::Machine => "machine",
        }
    }

    fn stage_for_fullness(self, fullness: f32) -> &'static str {
        match self {
            LifecycleFamily::Tree if fullness < 0.25 => "cut",
            LifecycleFamily::Tree if fullness < 0.58 => "regrowing",
            LifecycleFamily::Tree if fullness < 0.9 => "mature",
            LifecycleFamily::Tree => "ancient",
            LifecycleFamily::Deadwood if fullness < 0.28 => "hollowed",
            LifecycleFamily::Deadwood if fullness < 0.7 => "decaying",
            LifecycleFamily::Deadwood => "freshfall",
            LifecycleFamily::Mineral if fullness < 0.28 => "ruined",
            LifecycleFamily::Mineral if fullness < 0.34 => "scarred",
            LifecycleFamily::Mineral if fullness < 0.82 => "veined",
            LifecycleFamily::Mineral => "rich",
            LifecycleFamily::Mycelium if fullness < 0.3 => "dormant",
            LifecycleFamily::Mycelium if fullness < 0.8 => "fruiting",
            LifecycleFamily::Mycelium => "blooming",
            LifecycleFamily::Machine if fullness < 0.25 => "spent",
            LifecycleFamily::Machine if fullness < 0.75 => "sparking",
            LifecycleFamily::Machine => "charged",
        }
    }
}

impl ResourceNode {
    fn harvest(&mut self, amount: u32) -> Option<u32> {
        if self.amount == 0 {
            return None;
        }
        let harvested = self.amount.min(amount);
        self.amount -= harvested;
        Some(harvested)
    }

    fn restore(&mut self, amount: u32) {
        self.amount = self.amount.saturating_add(amount).min(self.max_amount);
    }

    fn feed(&mut self, amount: u32) -> Option<u32> {
        if self.amount >= self.max_amount || amount == 0 {
            return None;
        }
        self.restore(amount);
        Some(self.amount)
    }

    fn regenerate(&mut self, dt: f32) -> bool {
        if self.amount >= self.max_amount || self.regen_per_second <= 0.0 {
            return false;
        }
        let before = self.amount;
        self.regen_progress += self.regen_per_second * dt.max(0.0);
        while self.regen_progress >= 1.0 && self.amount < self.max_amount {
            self.amount += 1;
            self.regen_progress -= 1.0;
        }
        if self.amount >= self.max_amount {
            self.regen_progress = 0.0;
        }
        self.amount != before
    }

    fn changed_event(&self, object_id: &str) -> ResourceNodeChangedEvent {
        ResourceNodeChangedEvent {
            object_id: object_id.to_string(),
            resource: self.resource,
            amount: self.amount,
            max_amount: self.max_amount,
        }
    }

    fn resource_snapshot(&self) -> ObjectResourceSnapshot {
        ObjectResourceSnapshot {
            kind: self.resource,
            amount: self.amount,
            max_amount: self.max_amount,
        }
    }

    fn lifecycle_snapshot(&self) -> ObjectLifecycleSnapshot {
        let fullness = if self.max_amount == 0 {
            0.0
        } else {
            self.amount as f32 / self.max_amount as f32
        }
        .clamp(0.0, 1.0);
        let stage = self
            .stage_override
            .unwrap_or_else(|| self.lifecycle_family.stage_for_fullness(fullness));
        ObjectLifecycleSnapshot {
            family: self.lifecycle_family.snapshot_family().to_string(),
            stage: stage.to_string(),
            species: self.species.map(str::to_string),
            age_years: self.age_years,
            health: self.lifecycle_health(fullness),
            growth: fullness,
            decay: match self.lifecycle_family {
                LifecycleFamily::Mycelium => (1.0 - fullness * 0.35).clamp(0.0, 1.0),
                LifecycleFamily::Deadwood => (0.45 + fullness * 0.45).clamp(0.0, 1.0),
                LifecycleFamily::Tree => (1.0 - fullness).clamp(0.0, 1.0) * 0.45,
                LifecycleFamily::Mineral => (1.0 - fullness).clamp(0.0, 1.0) * 0.72,
                LifecycleFamily::Machine => (1.0 - fullness).clamp(0.0, 1.0) * 0.2,
            },
        }
    }

    fn lifecycle_health(&self, fullness: f32) -> f32 {
        match self.lifecycle_family {
            LifecycleFamily::Tree => (self.base_health * (0.72 + fullness * 0.28)).clamp(0.0, 1.0),
            LifecycleFamily::Deadwood => {
                (self.base_health * (0.4 + fullness * 0.6)).clamp(0.0, 1.0)
            }
            LifecycleFamily::Mineral => {
                (self.base_health * (0.52 + fullness * 0.48)).clamp(0.0, 1.0)
            }
            LifecycleFamily::Mycelium => {
                (self.base_health * (0.66 + fullness * 0.34)).clamp(0.0, 1.0)
            }
            LifecycleFamily::Machine => (self.base_health * fullness).clamp(0.0, 1.0),
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct PlayerInput {
    pub up: bool,
    pub down: bool,
    pub left: bool,
    pub right: bool,
    pub interact: bool,
}

#[derive(Debug, Default)]
pub struct SimTickOutcome {
    pub settlement_jobs: Vec<SettlementJob>,
    pub resource_events: Vec<ResourceGatheredEvent>,
    pub resource_feed_events: Vec<ResourceFedEvent>,
    pub resource_node_events: Vec<ResourceNodeChangedEvent>,
    pub crafting_events: Vec<ItemCraftedEvent>,
}

#[derive(Debug, Clone)]
pub struct ResourceGatheredEvent {
    pub player_id: PlayerId,
    pub object_id: String,
    pub resource: ResourceKind,
    pub amount: u32,
    pub total: u32,
}

#[derive(Debug, Clone)]
pub struct ResourceNodeChangedEvent {
    pub object_id: String,
    pub resource: ResourceKind,
    pub amount: u32,
    pub max_amount: u32,
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
struct EcologyFeedCandidate {
    entity: Entity,
    object_id: String,
    position: Position,
}

#[derive(Debug, Clone)]
pub struct ItemCraftedEvent {
    pub player_id: PlayerId,
    pub object_id: String,
    pub item_id: String,
    pub amount: u32,
    pub total: u32,
}

#[derive(Debug, Clone)]
struct MapBounds {
    width: f32,
    height: f32,
    safe_zone_radius: f32,
    terrain_snapshot: TerrainSnapshot,
    spawn: Position,
}

#[derive(Debug)]
pub struct SimWorld {
    world: World,
    tick: u64,
    map: MapBounds,
    players: HashMap<PlayerId, Entity>,
    inputs: HashMap<PlayerId, PlayerInput>,
    interact_latches: HashMap<PlayerId, bool>,
    player_name_index: HashMap<String, PlayerId>,
    player_index: SpatialIndex<Entity>,
    object_entities: HashMap<String, Entity>,
    object_index: SpatialIndex<Entity>,
    max_object_radius: f32,
    terrain: TerrainAuthority,
    terrain_detail_blockers: Vec<MovementBlocker>,
}

impl SimWorld {
    #[cfg(test)]
    pub fn new() -> Self {
        Self::from_content(WorldContent::demo())
    }

    #[cfg(test)]
    pub fn from_content(content: WorldContent) -> Self {
        Self::from_content_with_terrain_detail_authority(content, None)
            .expect("empty terrain detail authority should be valid")
    }

    pub fn from_content_with_terrain_detail_authority(
        content: WorldContent,
        terrain_detail_authority: Option<TerrainDetailAuthority>,
    ) -> Result<Self, String> {
        let mut world = World::new();
        let terrain_snapshot = content
            .map
            .terrain
            .expect("validated world content includes terrain")
            .snapshot();
        let terrain_detail_blockers = terrain_detail_authority_blockers(
            terrain_detail_authority.as_ref(),
            &terrain_snapshot,
        )?;
        let terrain = TerrainAuthority::new(
            terrain_snapshot.clone(),
            content.map.width,
            content.map.height,
            content.map.safe_zone_radius,
        );
        let map = MapBounds {
            width: content.map.width,
            height: content.map.height,
            safe_zone_radius: content.map.safe_zone_radius,
            terrain_snapshot,
            spawn: Position {
                x: content.spawn.x,
                y: content.spawn.y,
            },
        };

        let mut object_index = SpatialIndex::new(SPATIAL_CELL_SIZE);
        let mut object_entities = HashMap::new();
        let mut max_object_radius: f32 = 0.0;
        for object in content.objects {
            max_object_radius = max_object_radius.max(object.radius);
            let object_id = object.id.clone();
            let entity = spawn_object(
                &mut world,
                &object.id,
                object.kind,
                &object.label,
                object.x,
                object.y,
                object.radius,
            );
            object_index.insert_or_update(
                entity,
                Point {
                    x: object.x,
                    y: object.y,
                },
            );
            object_entities.insert(object_id, entity);
        }
        for object in generated_ecology_objects() {
            max_object_radius = max_object_radius.max(object.radius);
            let object_id = object.id.to_string();
            let entity = spawn_object(
                &mut world,
                object.id,
                object.kind,
                object.label,
                object.x,
                object.y,
                object.radius,
            );
            object_index.insert_or_update(
                entity,
                Point {
                    x: object.x,
                    y: object.y,
                },
            );
            object_entities.insert(object_id, entity);
        }

        Ok(Self {
            world,
            tick: 0,
            map,
            players: HashMap::new(),
            inputs: HashMap::new(),
            interact_latches: HashMap::new(),
            player_name_index: HashMap::new(),
            player_index: SpatialIndex::new(SPATIAL_CELL_SIZE),
            object_entities,
            object_index,
            max_object_radius,
            terrain,
            terrain_detail_blockers,
        })
    }

    #[cfg(test)]
    pub fn add_player(&mut self, id: PlayerId) {
        self.add_player_with_identity(id, None, None)
            .expect("default player name should be valid");
    }

    #[cfg(test)]
    pub fn add_player_with_display_name(
        &mut self,
        id: PlayerId,
        display_name: Option<String>,
    ) -> Result<(), PlayerNameError> {
        self.add_player_with_identity(id, display_name, None)
    }

    pub fn add_player_with_identity(
        &mut self,
        id: PlayerId,
        display_name: Option<String>,
        account_subject: Option<String>,
    ) -> Result<(), PlayerNameError> {
        let color = color_for(id);
        let offset = (self.players.len() as f32 * 37.0) % 180.0;
        let name = match display_name {
            Some(name) => {
                let clean_name = validate_player_name(&name)?;
                if !self.is_player_name_available(&clean_name, Some(id)) {
                    return Err(PlayerNameError::Taken);
                }
                clean_name
            }
            None => self.default_player_name(id),
        };
        let name_key = player_name_key(&name);
        let entity = self
            .world
            .spawn((
                Player {
                    id,
                    account_subject,
                    name: name.clone(),
                    color,
                    demo_deeds: Vec::new(),
                    inventory: PlayerInventory::default(),
                },
                Position {
                    x: self.map.spawn.x + offset,
                    y: self.map.spawn.y + offset / 3.0,
                },
                Velocity::default(),
            ))
            .id();
        self.player_name_index.insert(name_key, id);
        self.players.insert(id, entity);
        self.inputs.insert(id, PlayerInput::default());
        self.interact_latches.insert(id, false);
        self.player_index.insert_or_update(
            entity,
            Point {
                x: self.map.spawn.x + offset,
                y: self.map.spawn.y + offset / 3.0,
            },
        );
        Ok(())
    }

    pub fn remove_player(&mut self, id: PlayerId) {
        if let Some(entity) = self.players.remove(&id) {
            if let Some(player) = self.world.get::<Player>(entity) {
                self.player_name_index
                    .remove(&player_name_key(&player.name));
            }
            self.player_index.remove(entity);
            let _ = self.world.despawn(entity);
        }
        self.inputs.remove(&id);
        self.interact_latches.remove(&id);
    }

    pub fn rename_player(
        &mut self,
        id: PlayerId,
        name: &str,
    ) -> Result<Option<String>, PlayerNameError> {
        let clean_name = validate_player_name(name)?;
        let Some(entity) = self.players.get(&id).copied() else {
            return Ok(None);
        };
        if !self.is_player_name_available(&clean_name, Some(id)) {
            return Err(PlayerNameError::Taken);
        }
        let Some(player) = self.world.get::<Player>(entity) else {
            return Ok(None);
        };
        let old_key = player_name_key(&player.name);
        let new_key = player_name_key(&clean_name);
        if old_key != new_key {
            self.player_name_index.remove(&old_key);
            self.player_name_index.insert(new_key, id);
        }
        if let Some(mut player) = self.world.get_mut::<Player>(entity) {
            player.name = clean_name.clone();
            return Ok(Some(clean_name));
        }
        Ok(None)
    }

    pub fn is_player_name_available(&self, name: &str, owner: Option<PlayerId>) -> bool {
        match self.player_name_index.get(&player_name_key(name)) {
            Some(existing_owner) => Some(*existing_owner) == owner,
            None => true,
        }
    }

    fn default_player_name(&self, id: PlayerId) -> String {
        let base = format!("Wayfarer-{}", &id.to_string()[..4]);
        if self.is_player_name_available(&base, Some(id)) {
            return base;
        }

        for suffix in 2..1000 {
            let candidate = format!("{base}-{suffix}");
            if candidate.chars().count() <= PLAYER_NAME_MAX_CHARS
                && self.is_player_name_available(&candidate, Some(id))
            {
                return candidate;
            }
        }

        format!("Wayfarer-{}", &Uuid::new_v4().to_string()[..4])
    }

    pub fn set_input(&mut self, id: PlayerId, input: PlayerInput) {
        if self.players.contains_key(&id) {
            self.inputs.insert(id, input);
        }
    }

    pub fn tick(&mut self, dt: f32) -> SimTickOutcome {
        self.tick += 1;
        let mut outcome = SimTickOutcome::default();
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

        let mut movers = self.world.query::<(Entity, &mut Position, &Velocity)>();
        for (entity, mut position, velocity) in movers.iter_mut(&mut self.world) {
            let candidate = Position {
                x: (position.x + velocity.x * dt).clamp(28.0, self.map.width - 28.0),
                y: (position.y + velocity.y * dt).clamp(28.0, self.map.height - 28.0),
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

    pub fn snapshot(&mut self, settlement: SettlementSnapshot) -> WorldSnapshot {
        WorldSnapshot {
            tick: self.tick,
            map: self.map_snapshot(),
            players: self.player_snapshots(None, None, f32::INFINITY),
            objects: self.object_snapshots(None, None, f32::INFINITY),
            settlement,
        }
    }

    pub fn snapshot_for_player(
        &mut self,
        player_id: PlayerId,
        settlement: SettlementSnapshot,
        interest_radius: f32,
    ) -> WorldSnapshot {
        let center = self
            .players
            .get(&player_id)
            .and_then(|entity| self.world.get::<Position>(*entity).copied());
        let player_entities = center.map(|center| {
            self.player_index
                .query_radius(point_from_position(center), interest_radius)
        });
        let object_entities = center.map(|center| {
            self.object_index.query_radius(
                point_from_position(center),
                interest_radius + self.max_object_radius,
            )
        });

        WorldSnapshot {
            tick: self.tick,
            map: self.map_snapshot(),
            players: self.player_snapshots(player_entities.as_deref(), center, interest_radius),
            objects: self.object_snapshots(object_entities.as_deref(), center, interest_radius),
            settlement,
        }
    }

    fn try_claim_demo_deed(&mut self, id: PlayerId, entity: Entity) -> Option<SettlementJob> {
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

    fn try_gather_resource(
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

    fn try_feed_mycelium(
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

    fn try_craft_item(
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

    fn nearest_feedable_mycelium(&self, player_position: Position) -> Option<GatherTarget> {
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

    fn nearest_deadwood_receiver(&self, source_position: Position) -> Option<GatherTarget> {
        self.object_index
            .query_radius(
                point_from_position(source_position),
                TREE_HARVEST_FALLOUT_RADIUS + self.max_object_radius,
            )
            .into_iter()
            .filter_map(|entity| {
                let object = self.world.get::<WorldObject>(entity)?;
                let position = self.world.get::<Position>(entity)?;
                let resource_node = object.resource_node.as_ref()?;
                if resource_node.lifecycle_family != LifecycleFamily::Deadwood
                    || resource_node.resource != ResourceKind::Deadwood
                    || resource_node.amount >= resource_node.max_amount
                {
                    return None;
                }
                let distance = distance(source_position, *position);
                if distance > TREE_HARVEST_FALLOUT_RADIUS {
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

    fn add_tree_harvest_fallout(
        &mut self,
        source_position: Position,
    ) -> Option<ResourceNodeChangedEvent> {
        let target = self.nearest_deadwood_receiver(source_position)?;
        let mut object = self.world.get_mut::<WorldObject>(target.entity)?;
        let resource_node = object.resource_node.as_mut()?;
        if resource_node.lifecycle_family != LifecycleFamily::Deadwood
            || resource_node.resource != ResourceKind::Deadwood
        {
            return None;
        }
        resource_node.feed(TREE_HARVEST_FALLOUT_AMOUNT)?;
        Some(resource_node.changed_event(&target.object_id))
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

    fn decay_deadwood_into_mycelium(&mut self) -> Vec<ResourceNodeChangedEvent> {
        if self.tick % ECOLOGY_DECAY_FEED_INTERVAL_TICKS != 0 {
            return Vec::new();
        }

        let (mut deadwood_sources, mut mycelium_targets) = self.ecology_feed_candidates();
        deadwood_sources.sort_by(|a, b| a.object_id.cmp(&b.object_id));
        mycelium_targets.sort_by(|a, b| a.object_id.cmp(&b.object_id));

        let mut events = Vec::new();
        for source in deadwood_sources {
            let Some(target) = mycelium_targets
                .iter()
                .filter(|target| {
                    distance(source.position, target.position) <= ECOLOGY_DECAY_FEED_RADIUS
                })
                .min_by(|a, b| {
                    distance(source.position, a.position)
                        .total_cmp(&distance(source.position, b.position))
                })
                .cloned()
            else {
                continue;
            };

            if !self.is_feedable_mycelium(target.entity) {
                continue;
            }

            let Some((harvested, source_event)) =
                self.harvest_ecology_deadwood(source.entity, &source.object_id)
            else {
                continue;
            };

            let Some(target_event) =
                self.feed_ecology_mycelium(target.entity, &target.object_id, harvested)
            else {
                self.restore_ecology_deadwood(source.entity, harvested);
                continue;
            };

            events.push(source_event);
            events.push(target_event);
        }

        events
    }

    fn charge_mycelium_from_field_coils(&mut self) -> Vec<ResourceNodeChangedEvent> {
        if self.tick % COIL_MYCELIUM_CHARGE_INTERVAL_TICKS != 0 {
            return Vec::new();
        }

        let (mut coils, mut mycelium_targets) = self.coil_charge_candidates();
        coils.sort_by(|a, b| a.object_id.cmp(&b.object_id));
        mycelium_targets.sort_by(|a, b| a.object_id.cmp(&b.object_id));

        let mut events = Vec::new();
        for coil in coils {
            let Some(target) = mycelium_targets
                .iter()
                .filter(|target| {
                    distance(coil.position, target.position) <= COIL_MYCELIUM_CHARGE_RADIUS
                })
                .min_by(|a, b| {
                    distance(coil.position, a.position)
                        .total_cmp(&distance(coil.position, b.position))
                })
                .cloned()
            else {
                continue;
            };

            if !self.is_feedable_mycelium(target.entity) {
                continue;
            }

            let Some((spent, coil_event)) =
                self.harvest_field_coil_charge(coil.entity, &coil.object_id)
            else {
                continue;
            };

            let Some(target_event) =
                self.feed_ecology_mycelium(target.entity, &target.object_id, spent)
            else {
                self.restore_field_coil_charge(coil.entity, spent);
                continue;
            };

            events.push(coil_event);
            events.push(target_event);
        }

        events
    }

    fn coil_charge_candidates(&mut self) -> (Vec<EcologyFeedCandidate>, Vec<EcologyFeedCandidate>) {
        let mut coils = Vec::new();
        let mut mycelium_targets = Vec::new();
        let mut query = self.world.query::<(Entity, &WorldObject, &Position)>();
        for (entity, object, position) in query.iter(&self.world) {
            let Some(resource_node) = object.resource_node.as_ref() else {
                continue;
            };

            if resource_node.lifecycle_family == LifecycleFamily::Machine
                && resource_node.resource == ResourceKind::Charge
                && resource_node.amount > 0
            {
                coils.push(EcologyFeedCandidate {
                    entity,
                    object_id: object.id.clone(),
                    position: *position,
                });
            } else if resource_node.lifecycle_family == LifecycleFamily::Mycelium
                && resource_node.resource == ResourceKind::Mycelium
                && resource_node.amount < resource_node.max_amount
            {
                mycelium_targets.push(EcologyFeedCandidate {
                    entity,
                    object_id: object.id.clone(),
                    position: *position,
                });
            }
        }
        (coils, mycelium_targets)
    }

    fn ecology_feed_candidates(
        &mut self,
    ) -> (Vec<EcologyFeedCandidate>, Vec<EcologyFeedCandidate>) {
        let mut deadwood_sources = Vec::new();
        let mut mycelium_targets = Vec::new();
        let mut query = self.world.query::<(Entity, &WorldObject, &Position)>();
        for (entity, object, position) in query.iter(&self.world) {
            let Some(resource_node) = object.resource_node.as_ref() else {
                continue;
            };

            if resource_node.lifecycle_family == LifecycleFamily::Deadwood
                && resource_node.resource == ResourceKind::Deadwood
                && resource_node.amount > 0
            {
                deadwood_sources.push(EcologyFeedCandidate {
                    entity,
                    object_id: object.id.clone(),
                    position: *position,
                });
            } else if resource_node.lifecycle_family == LifecycleFamily::Mycelium
                && resource_node.resource == ResourceKind::Mycelium
                && resource_node.amount < resource_node.max_amount
            {
                mycelium_targets.push(EcologyFeedCandidate {
                    entity,
                    object_id: object.id.clone(),
                    position: *position,
                });
            }
        }
        (deadwood_sources, mycelium_targets)
    }

    fn is_feedable_mycelium(&self, entity: Entity) -> bool {
        let Some(object) = self.world.get::<WorldObject>(entity) else {
            return false;
        };
        let Some(resource_node) = object.resource_node.as_ref() else {
            return false;
        };
        resource_node.lifecycle_family == LifecycleFamily::Mycelium
            && resource_node.resource == ResourceKind::Mycelium
            && resource_node.amount < resource_node.max_amount
    }

    fn harvest_ecology_deadwood(
        &mut self,
        entity: Entity,
        object_id: &str,
    ) -> Option<(u32, ResourceNodeChangedEvent)> {
        let mut object = self.world.get_mut::<WorldObject>(entity)?;
        let resource_node = object.resource_node.as_mut()?;
        if resource_node.lifecycle_family != LifecycleFamily::Deadwood
            || resource_node.resource != ResourceKind::Deadwood
        {
            return None;
        }
        let harvested = resource_node.harvest(MYCELIUM_FEED_AMOUNT)?;
        Some((harvested, resource_node.changed_event(object_id)))
    }

    fn feed_ecology_mycelium(
        &mut self,
        entity: Entity,
        object_id: &str,
        amount: u32,
    ) -> Option<ResourceNodeChangedEvent> {
        let mut object = self.world.get_mut::<WorldObject>(entity)?;
        let resource_node = object.resource_node.as_mut()?;
        if resource_node.lifecycle_family != LifecycleFamily::Mycelium
            || resource_node.resource != ResourceKind::Mycelium
        {
            return None;
        }
        resource_node.feed(amount)?;
        Some(resource_node.changed_event(object_id))
    }

    fn restore_ecology_deadwood(&mut self, entity: Entity, amount: u32) {
        let Some(mut object) = self.world.get_mut::<WorldObject>(entity) else {
            return;
        };
        let Some(resource_node) = object.resource_node.as_mut() else {
            return;
        };
        if resource_node.lifecycle_family == LifecycleFamily::Deadwood
            && resource_node.resource == ResourceKind::Deadwood
        {
            resource_node.restore(amount);
        }
    }

    fn harvest_field_coil_charge(
        &mut self,
        entity: Entity,
        object_id: &str,
    ) -> Option<(u32, ResourceNodeChangedEvent)> {
        let mut object = self.world.get_mut::<WorldObject>(entity)?;
        let resource_node = object.resource_node.as_mut()?;
        if resource_node.lifecycle_family != LifecycleFamily::Machine
            || resource_node.resource != ResourceKind::Charge
        {
            return None;
        }
        let spent = resource_node.harvest(MYCELIUM_FEED_AMOUNT)?;
        Some((spent, resource_node.changed_event(object_id)))
    }

    fn restore_field_coil_charge(&mut self, entity: Entity, amount: u32) {
        let Some(mut object) = self.world.get_mut::<WorldObject>(entity) else {
            return;
        };
        let Some(resource_node) = object.resource_node.as_mut() else {
            return;
        };
        if resource_node.lifecycle_family == LifecycleFamily::Machine
            && resource_node.resource == ResourceKind::Charge
        {
            resource_node.restore(amount);
        }
    }

    fn object_position(&self, id: &str) -> Option<Position> {
        self.object_entities
            .get(id)
            .and_then(|entity| self.world.get::<Position>(*entity).copied())
    }

    fn movement_blockers(&mut self) -> Vec<MovementBlocker> {
        let mut blockers = self.terrain_detail_blockers.clone();
        let mut query = self.world.query::<(&WorldObject, &Position)>();
        for (object, position) in query.iter(&self.world) {
            if object_kind_blocks_movement(&object.kind) {
                blockers.push(MovementBlocker::Circle {
                    position: *position,
                    radius: object_solid_radius(object.radius),
                });
            }
        }
        blockers
    }

    fn map_snapshot(&self) -> MapSnapshot {
        MapSnapshot {
            width: self.map.width,
            height: self.map.height,
            safe_zone_radius: self.map.safe_zone_radius,
            terrain: self.map.terrain_snapshot.clone(),
        }
    }

    fn player_snapshots(
        &mut self,
        candidates: Option<&[Entity]>,
        center: Option<Position>,
        interest_radius: f32,
    ) -> Vec<PlayerSnapshot> {
        let mut players = Vec::new();
        if let Some(candidates) = candidates {
            for entity in candidates {
                let Some((player, position)) = self
                    .world
                    .get::<Player>(*entity)
                    .zip(self.world.get::<Position>(*entity))
                else {
                    continue;
                };
                players.push(player_snapshot(player, position));
            }
        } else {
            let mut query = self.world.query::<(&Player, &Position)>();
            for (player, position) in query.iter(&self.world) {
                players.push(player_snapshot(player, position));
            }
        }
        if let Some(center) = center {
            players.retain(|player| {
                distance(
                    center,
                    Position {
                        x: player.x,
                        y: player.y,
                    },
                ) <= interest_radius
            });
        }
        players.sort_by_key(|player| player.id);
        players
    }

    fn object_snapshots(
        &mut self,
        candidates: Option<&[Entity]>,
        center: Option<Position>,
        interest_radius: f32,
    ) -> Vec<ObjectSnapshot> {
        let mut objects = Vec::new();
        if let Some(candidates) = candidates {
            for entity in candidates {
                let Some((object, position)) = self
                    .world
                    .get::<WorldObject>(*entity)
                    .zip(self.world.get::<Position>(*entity))
                else {
                    continue;
                };
                objects.push(object_snapshot(object, position));
            }
        } else {
            let mut object_query = self.world.query::<(&WorldObject, &Position)>();
            for (object, position) in object_query.iter(&self.world) {
                objects.push(object_snapshot(object, position));
            }
        }
        if let Some(center) = center {
            objects.retain(|object| {
                distance(
                    center,
                    Position {
                        x: object.x,
                        y: object.y,
                    },
                ) <= interest_radius + object.radius
            });
        }
        objects.sort_by(|a, b| a.id.cmp(&b.id));
        objects
    }
}

#[derive(Debug)]
struct GatherTarget {
    entity: Entity,
    object_id: String,
    resource: ResourceKind,
    position: Position,
    distance: f32,
}

#[derive(Debug, Clone, Copy)]
enum MovementBlocker {
    Circle {
        position: Position,
        radius: f32,
    },
    Aabb {
        position: Position,
        half_width: f32,
        half_height: f32,
    },
}

struct GeneratedEcologyObject {
    id: &'static str,
    kind: ObjectKind,
    label: &'static str,
    x: f32,
    y: f32,
    radius: f32,
}

fn generated_ecology_objects() -> [GeneratedEcologyObject; 11] {
    [
        GeneratedEcologyObject {
            id: "young-grove-sapling",
            kind: ObjectKind::SaplingTree,
            label: "Sapling",
            x: 356.0,
            y: 364.0,
            radius: 30.0,
        },
        GeneratedEcologyObject {
            id: "mossheart-grove-tree",
            kind: ObjectKind::SaplingTree,
            label: "Mossheart Tree",
            x: 410.0,
            y: 438.0,
            radius: 38.0,
        },
        GeneratedEcologyObject {
            id: "ancient-ironleaf-tree",
            kind: ObjectKind::SaplingTree,
            label: "Ancient Ironleaf",
            x: 742.0,
            y: 518.0,
            radius: 46.0,
        },
        GeneratedEcologyObject {
            id: "fallen-grove-log",
            kind: ObjectKind::Deadwood,
            label: "Fallen Log",
            x: 520.0,
            y: 384.0,
            radius: 34.0,
        },
        GeneratedEcologyObject {
            id: "shrine-mycelium-bloom",
            kind: ObjectKind::MyceliumPatch,
            label: "Mycelium Bloom",
            x: 1018.0,
            y: 342.0,
            radius: 30.0,
        },
        GeneratedEcologyObject {
            id: "decaying-grove-stump",
            kind: ObjectKind::Deadwood,
            label: "Decaying Stump",
            x: 950.0,
            y: 362.0,
            radius: 28.0,
        },
        GeneratedEcologyObject {
            id: "hollow-grove-stump",
            kind: ObjectKind::Deadwood,
            label: "Hollow Stump",
            x: 856.0,
            y: 430.0,
            radius: 26.0,
        },
        GeneratedEcologyObject {
            id: "veilcap-runner",
            kind: ObjectKind::MyceliumPatch,
            label: "Veilcap Runner",
            x: 914.0,
            y: 454.0,
            radius: 26.0,
        },
        GeneratedEcologyObject {
            id: "stormroot-field-coil",
            kind: ObjectKind::FieldCoil,
            label: "Stormroot Coil",
            x: 982.0,
            y: 506.0,
            radius: 30.0,
        },
        GeneratedEcologyObject {
            id: "field-coil",
            kind: ObjectKind::FieldCoil,
            label: "Field Coil",
            x: 1205.0,
            y: 540.0,
            radius: 34.0,
        },
        GeneratedEcologyObject {
            id: "ancient-viaduct-ruin",
            kind: ObjectKind::Ruin,
            label: "Ancient Viaduct Ruin",
            x: 690.0,
            y: 372.0,
            radius: 42.0,
        },
    ]
}

fn spawn_object(
    world: &mut World,
    id: &str,
    kind: ObjectKind,
    label: &str,
    x: f32,
    y: f32,
    radius: f32,
) -> Entity {
    world
        .spawn((
            WorldObject {
                id: id.to_string(),
                kind: kind.clone(),
                label: label.to_string(),
                radius,
                resource_node: resource_node_for_object(kind, id),
            },
            Position { x, y },
        ))
        .id()
}

fn player_snapshot(player: &Player, position: &Position) -> PlayerSnapshot {
    PlayerSnapshot {
        id: player.id,
        account_subject: player.account_subject.clone(),
        name: player.name.clone(),
        x: position.x,
        y: position.y,
        color: player.color.clone(),
        demo_deeds: player.demo_deeds.clone(),
        resources: ResourceSnapshot {
            wood: player.inventory.resource_total(ResourceKind::Wood),
            ore: player.inventory.resource_total(ResourceKind::Ore),
            stone: player.inventory.resource_total(ResourceKind::Stone),
            charge: player.inventory.resource_total(ResourceKind::Charge),
            deadwood: player.inventory.resource_total(ResourceKind::Deadwood),
            fiber: player.inventory.resource_total(ResourceKind::Fiber),
            mycelium: player.inventory.resource_total(ResourceKind::Mycelium),
            spores: player.inventory.resource_total(ResourceKind::Spores),
            seed: player.inventory.resource_total(ResourceKind::Seed),
        },
        inventory: player.inventory.snapshot(),
    }
}

fn object_snapshot(object: &WorldObject, position: &Position) -> ObjectSnapshot {
    let resources = object
        .resource_node
        .as_ref()
        .map(|node| vec![node.resource_snapshot()])
        .unwrap_or_default();
    let lifecycle = object
        .resource_node
        .as_ref()
        .map(ResourceNode::lifecycle_snapshot);
    ObjectSnapshot {
        id: object.id.clone(),
        kind: object.kind.clone(),
        label: object.label.clone(),
        x: position.x,
        y: position.y,
        radius: object.radius,
        resources,
        lifecycle,
    }
}

fn axis(negative: bool, positive: bool) -> f32 {
    match (negative, positive) {
        (true, false) => -1.0,
        (false, true) => 1.0,
        _ => 0.0,
    }
}

fn movement_scale(horizontal: f32, vertical: f32) -> f32 {
    if horizontal != 0.0 && vertical != 0.0 {
        FRAC_1_SQRT_2
    } else {
        1.0
    }
}

fn terrain_detail_authority_blockers(
    authority: Option<&TerrainDetailAuthority>,
    terrain_snapshot: &TerrainSnapshot,
) -> Result<Vec<MovementBlocker>, String> {
    let Some(authority) = authority else {
        return Ok(Vec::new());
    };
    if authority.schema_version != "duskfell-terrain-detail-authority-v1" {
        return Err("terrain detail authority schemaVersion is unsupported".to_string());
    }
    if authority.projection != "military-plan-oblique" {
        return Err("terrain detail authority projection is unsupported".to_string());
    }
    if authority.profile != terrain_snapshot.profile {
        return Err(format!(
            "terrain detail authority profile {} does not match terrain profile {}",
            authority.profile, terrain_snapshot.profile
        ));
    }
    if authority.units_per_tile != terrain_snapshot.units_per_tile {
        return Err(format!(
            "terrain detail authority unitsPerTile {} does not match terrain unitsPerTile {}",
            authority.units_per_tile, terrain_snapshot.units_per_tile
        ));
    }

    let units_per_tile = authority.units_per_tile as f32;
    authority
        .blockers
        .iter()
        .filter(|blocker| blocker.collision.blocks_movement)
        .map(|blocker| {
            if blocker.collision.shape != "aabb" {
                return Err(format!(
                    "terrain detail blocker {} uses unsupported collision shape {}",
                    blocker.id, blocker.collision.shape
                ));
            }
            if !blocker.x.is_finite()
                || !blocker.y.is_finite()
                || !blocker.collision.width_tiles.is_finite()
                || !blocker.collision.height_tiles.is_finite()
                || blocker.collision.width_tiles <= 0.0
                || blocker.collision.height_tiles <= 0.0
            {
                return Err(format!(
                    "terrain detail blocker {} has invalid collision geometry",
                    blocker.id
                ));
            }
            Ok(MovementBlocker::Aabb {
                position: Position {
                    x: blocker.x,
                    y: blocker.y,
                },
                half_width: blocker.collision.width_tiles * units_per_tile / 2.0,
                half_height: blocker.collision.height_tiles * units_per_tile / 2.0,
            })
        })
        .collect()
}

fn player_step_allowed(
    terrain: &TerrainAuthority,
    blockers: &[MovementBlocker],
    from: Position,
    to: Position,
) -> bool {
    terrain.allows_step(from.x, from.y, to.x, to.y)
        && !blockers
            .iter()
            .any(|blocker| object_blocks_player_step(*blocker, from, to))
}

fn object_blocks_player_step(blocker: MovementBlocker, from: Position, to: Position) -> bool {
    match blocker {
        MovementBlocker::Circle { position, radius } => {
            let collision_radius = radius + PLAYER_COLLISION_RADIUS;
            let from_distance = distance(from, position);
            let to_distance = distance(to, position);
            to_distance < collision_radius && to_distance < from_distance
        }
        MovementBlocker::Aabb {
            position,
            half_width,
            half_height,
        } => {
            let from_penetration = aabb_penetration(from, position, half_width, half_height);
            let to_penetration = aabb_penetration(to, position, half_width, half_height);
            to_penetration > 0.0 && to_penetration > from_penetration
        }
    }
}

fn aabb_penetration(point: Position, center: Position, half_width: f32, half_height: f32) -> f32 {
    let x_penetration = half_width + PLAYER_COLLISION_RADIUS - (point.x - center.x).abs();
    let y_penetration = half_height + PLAYER_COLLISION_RADIUS - (point.y - center.y).abs();
    x_penetration.min(y_penetration)
}

fn object_kind_blocks_movement(kind: &ObjectKind) -> bool {
    match kind {
        ObjectKind::Registrar
        | ObjectKind::Forge
        | ObjectKind::Grove
        | ObjectKind::Ore
        | ObjectKind::Shrine
        | ObjectKind::SaplingTree
        | ObjectKind::Deadwood
        | ObjectKind::FieldCoil
        | ObjectKind::Ruin => true,
        ObjectKind::MyceliumPatch => false,
    }
}

fn object_solid_radius(radius: f32) -> f32 {
    radius * OBJECT_SOLID_RADIUS_SCALE
}

fn distance(a: Position, b: Position) -> f32 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

fn resource_node_for_object(kind: ObjectKind, object_id: &str) -> Option<ResourceNode> {
    match kind {
        ObjectKind::Grove => Some(ResourceNode {
            resource: ResourceKind::Wood,
            amount: 8,
            max_amount: 12,
            regen_per_second: 0.08,
            regen_progress: 0.0,
            lifecycle_family: LifecycleFamily::Tree,
            stage_override: None,
            species: Some("ashbark"),
            age_years: Some(84),
            base_health: 0.78,
        }),
        ObjectKind::Ore => Some(ResourceNode {
            resource: ResourceKind::Ore,
            amount: 6,
            max_amount: 8,
            regen_per_second: 0.025,
            regen_progress: 0.0,
            lifecycle_family: LifecycleFamily::Mineral,
            stage_override: None,
            species: None,
            age_years: None,
            base_health: 1.0,
        }),
        ObjectKind::Ruin => Some(ResourceNode {
            resource: ResourceKind::Stone,
            amount: 2,
            max_amount: 12,
            regen_per_second: 0.0,
            regen_progress: 0.0,
            lifecycle_family: LifecycleFamily::Mineral,
            stage_override: Some("ancient-ruin"),
            species: Some("sunken-viaduct-stone"),
            age_years: Some(128_000),
            base_health: 0.42,
        }),
        ObjectKind::Shrine => Some(ResourceNode {
            resource: ResourceKind::Mycelium,
            amount: 5,
            max_amount: 7,
            regen_per_second: 0.045,
            regen_progress: 0.0,
            lifecycle_family: LifecycleFamily::Mycelium,
            stage_override: None,
            species: Some("shrine-thread"),
            age_years: Some(19),
            base_health: 0.86,
        }),
        ObjectKind::SaplingTree if object_id == "mossheart-grove-tree" => Some(ResourceNode {
            resource: ResourceKind::Wood,
            amount: 9,
            max_amount: 12,
            regen_per_second: 0.05,
            regen_progress: 0.0,
            lifecycle_family: LifecycleFamily::Tree,
            stage_override: Some("mature"),
            species: Some("shadebark"),
            age_years: Some(64),
            base_health: 0.88,
        }),
        ObjectKind::SaplingTree if object_id == "ancient-ironleaf-tree" => Some(ResourceNode {
            resource: ResourceKind::Wood,
            amount: 12,
            max_amount: 12,
            regen_per_second: 0.018,
            regen_progress: 0.0,
            lifecycle_family: LifecycleFamily::Tree,
            stage_override: Some("ancient"),
            species: Some("ironleaf"),
            age_years: Some(183),
            base_health: 0.72,
        }),
        ObjectKind::SaplingTree => Some(ResourceNode {
            resource: ResourceKind::Seed,
            amount: 1,
            max_amount: 3,
            regen_per_second: 0.035,
            regen_progress: 0.0,
            lifecycle_family: LifecycleFamily::Tree,
            stage_override: Some("sapling"),
            species: Some("greenwood"),
            age_years: Some(7),
            base_health: 0.94,
        }),
        ObjectKind::Deadwood if object_id == "decaying-grove-stump" => Some(ResourceNode {
            resource: ResourceKind::Deadwood,
            amount: 2,
            max_amount: 5,
            regen_per_second: 0.0,
            regen_progress: 0.0,
            lifecycle_family: LifecycleFamily::Deadwood,
            stage_override: None,
            species: Some("mossheart-fall"),
            age_years: Some(9),
            base_health: 0.18,
        }),
        ObjectKind::Deadwood if object_id == "hollow-grove-stump" => Some(ResourceNode {
            resource: ResourceKind::Deadwood,
            amount: 1,
            max_amount: 5,
            regen_per_second: 0.0,
            regen_progress: 0.0,
            lifecycle_family: LifecycleFamily::Deadwood,
            stage_override: None,
            species: Some("hollow-ash"),
            age_years: Some(16),
            base_health: 0.12,
        }),
        ObjectKind::Deadwood => Some(ResourceNode {
            resource: ResourceKind::Deadwood,
            amount: 4,
            max_amount: 5,
            regen_per_second: 0.0,
            regen_progress: 0.0,
            lifecycle_family: LifecycleFamily::Deadwood,
            stage_override: None,
            species: Some("fallen-ash"),
            age_years: Some(3),
            base_health: 0.28,
        }),
        ObjectKind::MyceliumPatch if object_id == "veilcap-runner" => Some(ResourceNode {
            resource: ResourceKind::Mycelium,
            amount: 1,
            max_amount: 4,
            regen_per_second: 0.035,
            regen_progress: 0.0,
            lifecycle_family: LifecycleFamily::Mycelium,
            stage_override: None,
            species: Some("runner-veilcap"),
            age_years: Some(1),
            base_health: 0.78,
        }),
        ObjectKind::MyceliumPatch => Some(ResourceNode {
            resource: ResourceKind::Mycelium,
            amount: 3,
            max_amount: 4,
            regen_per_second: 0.055,
            regen_progress: 0.0,
            lifecycle_family: LifecycleFamily::Mycelium,
            stage_override: None,
            species: Some("veilcap"),
            age_years: Some(1),
            base_health: 0.9,
        }),
        ObjectKind::FieldCoil if object_id == "stormroot-field-coil" => Some(ResourceNode {
            resource: ResourceKind::Charge,
            amount: 1,
            max_amount: 3,
            regen_per_second: 0.0,
            regen_progress: 0.0,
            lifecycle_family: LifecycleFamily::Machine,
            stage_override: None,
            species: Some("stormroot"),
            age_years: Some(4),
            base_health: 0.62,
        }),
        ObjectKind::FieldCoil => Some(ResourceNode {
            resource: ResourceKind::Charge,
            amount: 3,
            max_amount: 5,
            regen_per_second: 0.065,
            regen_progress: 0.0,
            lifecycle_family: LifecycleFamily::Machine,
            stage_override: None,
            species: None,
            age_years: Some(12),
            base_health: 0.82,
        }),
        ObjectKind::Registrar | ObjectKind::Forge => None,
    }
}

fn resource_item_id(resource: ResourceKind) -> &'static str {
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

fn resource_label(resource: ResourceKind) -> &'static str {
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

fn crafted_item_id(item: CraftedItemKind) -> &'static str {
    match item {
        CraftedItemKind::TrailKit => "trail-kit",
    }
}

fn crafted_item_label(item: CraftedItemKind) -> &'static str {
    match item {
        CraftedItemKind::TrailKit => "Trail Kit",
    }
}

fn inventory_item_id(item: InventoryItemKind) -> &'static str {
    match item {
        InventoryItemKind::Resource(resource) => resource_item_id(resource),
        InventoryItemKind::Crafted(item) => crafted_item_id(item),
    }
}

fn inventory_item_label(item: InventoryItemKind) -> &'static str {
    match item {
        InventoryItemKind::Resource(resource) => resource_label(resource),
        InventoryItemKind::Crafted(item) => crafted_item_label(item),
    }
}

fn point_from_position(position: Position) -> Point {
    Point {
        x: position.x,
        y: position.y,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlayerNameError {
    Empty,
    TooLong { max: usize },
    InvalidCharacters,
    Taken,
}

impl PlayerNameError {
    pub fn as_log_reason(&self) -> String {
        match self {
            Self::Empty => "invalid-player-name empty".to_string(),
            Self::TooLong { max } => format!("invalid-player-name too-long max={max}"),
            Self::InvalidCharacters => "invalid-player-name invalid-characters".to_string(),
            Self::Taken => "invalid-player-name already-active".to_string(),
        }
    }
}

fn player_name_key(name: &str) -> String {
    name.to_ascii_lowercase()
}

pub fn validate_player_name(name: &str) -> Result<String, PlayerNameError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(PlayerNameError::Empty);
    }
    if trimmed.chars().count() > PLAYER_NAME_MAX_CHARS {
        return Err(PlayerNameError::TooLong {
            max: PLAYER_NAME_MAX_CHARS,
        });
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(PlayerNameError::InvalidCharacters);
    }

    Ok(trimmed.to_string())
}

fn color_for(id: PlayerId) -> String {
    let bytes = id.as_bytes();
    let red = 72u8.saturating_add(bytes[0] % 112);
    let green = 84u8.saturating_add(bytes[7] % 112);
    let blue = 96u8.saturating_add(bytes[15] % 112);
    format!("#{red:02x}{green:02x}{blue:02x}")
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::*;
    use crate::protocol::SettlementSnapshot;
    use crate::terrain::TerrainMaterial;

    fn empty_settlement() -> SettlementSnapshot {
        SettlementSnapshot {
            chain_enabled: false,
            pending_jobs: 0,
            confirmed_jobs: 0,
            owned_assets: 0,
            latest_receipt: None,
        }
    }

    fn assert_node_event(
        events: &[ResourceNodeChangedEvent],
        object_id: &str,
        resource: ResourceKind,
        amount: u32,
    ) {
        assert!(
            events.iter().any(|event| {
                event.object_id == object_id && event.resource == resource && event.amount == amount
            }),
            "expected node event for {object_id} {resource:?} amount {amount}; got {events:?}"
        );
    }

    #[test]
    fn title_office_claim_updates_state_and_emits_one_settlement_job() {
        let player_id = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player(player_id);

        sim.set_input(
            player_id,
            PlayerInput {
                right: true,
                ..PlayerInput::default()
            },
        );
        for _ in 0..5 {
            let outcome = sim.tick(0.05);
            assert!(outcome.settlement_jobs.is_empty());
            assert!(outcome.resource_events.is_empty());
        }

        sim.set_input(
            player_id,
            PlayerInput {
                interact: true,
                ..PlayerInput::default()
            },
        );
        let outcome = sim.tick(0.05);
        let jobs = outcome.settlement_jobs;
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].player_id, player_id);
        assert!(jobs[0].asset_id.starts_with("dryrun-deed-"));
        assert!(outcome.resource_events.is_empty());

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should remain in snapshot");
        assert_eq!(player.demo_deeds, vec![jobs[0].asset_id.clone()]);

        let duplicate_outcome = sim.tick(0.05);
        assert!(duplicate_outcome.settlement_jobs.is_empty());
        assert!(duplicate_outcome.resource_events.is_empty());
    }

    #[test]
    fn account_subject_flows_to_player_snapshot_and_settlement_job() {
        let player_id = Uuid::new_v4();
        let account_subject = "acct:wallet:0xabc123".to_string();
        let mut sim = SimWorld::new();
        sim.add_player_with_identity(
            player_id,
            Some("Acct_7".to_string()),
            Some(account_subject.clone()),
        )
        .expect("account-bound player should spawn");

        move_player_to_object(&mut sim, player_id, "registrar", 8.0, 0.0);
        sim.set_input(
            player_id,
            PlayerInput {
                interact: true,
                ..PlayerInput::default()
            },
        );

        let outcome = sim.tick(0.05);
        assert_eq!(outcome.settlement_jobs.len(), 1);
        assert_eq!(
            outcome.settlement_jobs[0].account_subject.as_deref(),
            Some(account_subject.as_str())
        );

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should remain in snapshot");
        assert_eq!(
            player.account_subject.as_deref(),
            Some(account_subject.as_str())
        );
    }

    #[test]
    fn gathering_near_resource_nodes_updates_bounded_player_resources() {
        let player_id = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player(player_id);
        move_player_to_object(&mut sim, player_id, "north-grove", 8.0, 0.0);

        sim.set_input(
            player_id,
            PlayerInput {
                interact: true,
                ..PlayerInput::default()
            },
        );
        let outcome = sim.tick(0.05);
        assert!(outcome.settlement_jobs.is_empty());
        assert_eq!(outcome.resource_events.len(), 1);
        assert_eq!(outcome.resource_events[0].player_id, player_id);
        assert_eq!(outcome.resource_events[0].object_id, "north-grove");
        assert_eq!(outcome.resource_events[0].resource, ResourceKind::Wood);
        assert_eq!(outcome.resource_events[0].amount, 1);
        assert_eq!(outcome.resource_events[0].total, 1);
        assert_eq!(outcome.resource_node_events.len(), 2);
        assert_node_event(
            &outcome.resource_node_events,
            "north-grove",
            ResourceKind::Wood,
            7,
        );
        assert_node_event(
            &outcome.resource_node_events,
            "fallen-grove-log",
            ResourceKind::Deadwood,
            5,
        );

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should remain in snapshot");
        assert_eq!(player.resources.wood, 1);
        assert_eq!(player.resources.ore, 0);
        assert_eq!(player.inventory.capacity_slots, INVENTORY_CAPACITY_SLOTS);
        assert_eq!(player.inventory.items.len(), 1);
        assert_eq!(player.inventory.items[0].item_id, "wood");
        assert_eq!(player.inventory.items[0].quantity, 1);
        let grove = snapshot
            .objects
            .iter()
            .find(|object| object.id == "north-grove")
            .expect("grove should remain in snapshot");
        assert_eq!(grove.resources[0].kind, ResourceKind::Wood);
        assert_eq!(grove.resources[0].amount, 7);
        assert_eq!(grove.resources[0].max_amount, 12);
        assert_eq!(
            grove
                .lifecycle
                .as_ref()
                .map(|lifecycle| lifecycle.stage.as_str()),
            Some("mature")
        );
        let fallen_log = snapshot
            .objects
            .iter()
            .find(|object| object.id == "fallen-grove-log")
            .expect("fallen log should remain in snapshot");
        assert_eq!(fallen_log.resources[0].kind, ResourceKind::Deadwood);
        assert_eq!(fallen_log.resources[0].amount, 5);

        let held_key_outcome = sim.tick(0.05);
        assert!(held_key_outcome.resource_events.is_empty());

        sim.set_input(player_id, PlayerInput::default());
        sim.tick(0.05);
        move_player_to_object(&mut sim, player_id, "east-ore", -8.0, 0.0);
        sim.set_input(
            player_id,
            PlayerInput {
                interact: true,
                ..PlayerInput::default()
            },
        );
        let ore_outcome = sim.tick(0.05);
        assert_eq!(ore_outcome.resource_events.len(), 1);
        assert_eq!(ore_outcome.resource_events[0].resource, ResourceKind::Ore);

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should remain in snapshot");
        assert_eq!(player.resources.wood, 1);
        assert_eq!(player.resources.ore, 1);
        assert_eq!(player.inventory.items.len(), 2);
        assert!(player
            .inventory
            .items
            .iter()
            .any(|item| item.item_id == "ore" && item.quantity == 1));
    }

    #[test]
    fn resource_nodes_deplete_regrow_and_expose_decay_resources() {
        let player_id = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player(player_id);
        move_player_to_object(&mut sim, player_id, "old-shrine", 8.0, 0.0);

        sim.set_input(
            player_id,
            PlayerInput {
                interact: true,
                ..PlayerInput::default()
            },
        );
        let outcome = sim.tick(0.05);
        assert_eq!(outcome.resource_events.len(), 1);
        assert_eq!(outcome.resource_events[0].resource, ResourceKind::Mycelium);
        assert_eq!(outcome.resource_node_events.len(), 1);
        assert_eq!(outcome.resource_node_events[0].object_id, "old-shrine");
        assert_eq!(
            outcome.resource_node_events[0].resource,
            ResourceKind::Mycelium
        );
        assert_eq!(outcome.resource_node_events[0].amount, 4);

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should remain in snapshot");
        assert_eq!(player.resources.mycelium, 1);
        assert!(player
            .inventory
            .items
            .iter()
            .any(|item| item.item_id == "mycelium" && item.label == "Mycelium"));
        let shrine = snapshot
            .objects
            .iter()
            .find(|object| object.id == "old-shrine")
            .expect("shrine should remain in snapshot");
        assert_eq!(shrine.resources[0].kind, ResourceKind::Mycelium);
        assert_eq!(shrine.resources[0].amount, 4);
        assert_eq!(shrine.resources[0].max_amount, 7);
        let lifecycle = shrine
            .lifecycle
            .as_ref()
            .expect("resource node has lifecycle");
        assert_eq!(lifecycle.family, "mycelium");
        assert_eq!(lifecycle.stage, "fruiting");
        assert_eq!(lifecycle.species.as_deref(), Some("shrine-thread"));
        assert_eq!(lifecycle.age_years, Some(19));
        assert!(lifecycle.health > 0.0 && lifecycle.health <= 1.0);
        assert!(lifecycle.decay > 0.0);

        let mut regenerated = false;
        for _ in 0..30 {
            let outcome = sim.tick(1.0);
            regenerated |= outcome
                .resource_node_events
                .iter()
                .any(|event| event.object_id == "old-shrine" && event.amount > 4);
        }
        assert!(
            regenerated,
            "expected mycelium node regen to emit a durable node change"
        );
        let snapshot = sim.snapshot(empty_settlement());
        let shrine = snapshot
            .objects
            .iter()
            .find(|object| object.id == "old-shrine")
            .expect("shrine should remain in snapshot");
        assert!(
            shrine.resources[0].amount > 4,
            "expected mycelium node to regenerate after enough simulated time"
        );
    }

    #[test]
    fn generated_ecology_objects_are_addressable_resource_nodes() {
        let player_id = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player(player_id);

        let snapshot = sim.snapshot(empty_settlement());
        assert_eq!(
            snapshot
                .objects
                .iter()
                .filter(|object| matches!(
                    object.kind,
                    ObjectKind::SaplingTree
                        | ObjectKind::Deadwood
                        | ObjectKind::MyceliumPatch
                        | ObjectKind::FieldCoil
                        | ObjectKind::Ruin
                ))
                .count(),
            11
        );

        let deadwood = snapshot
            .objects
            .iter()
            .find(|object| object.id == "fallen-grove-log")
            .expect("generated deadwood should be present");
        assert_eq!(deadwood.kind, ObjectKind::Deadwood);
        assert_eq!(deadwood.resources[0].kind, ResourceKind::Deadwood);
        assert_eq!(
            deadwood
                .lifecycle
                .as_ref()
                .map(|lifecycle| lifecycle.stage.as_str()),
            Some("freshfall")
        );
        let deadwood_lifecycle = deadwood
            .lifecycle
            .as_ref()
            .expect("deadwood should expose lifecycle");
        assert_eq!(deadwood_lifecycle.family, "deadwood");
        assert_eq!(deadwood_lifecycle.species.as_deref(), Some("fallen-ash"));
        assert_eq!(deadwood_lifecycle.age_years, Some(3));
        assert!(deadwood_lifecycle.health > 0.0 && deadwood_lifecycle.health < 0.35);

        let decaying_stump = snapshot
            .objects
            .iter()
            .find(|object| object.id == "decaying-grove-stump")
            .expect("decaying stump should be present");
        assert_eq!(decaying_stump.kind, ObjectKind::Deadwood);
        assert_eq!(decaying_stump.resources[0].kind, ResourceKind::Deadwood);
        assert_eq!(decaying_stump.resources[0].amount, 2);
        let stump_lifecycle = decaying_stump
            .lifecycle
            .as_ref()
            .expect("decaying stump should expose lifecycle");
        assert_eq!(stump_lifecycle.family, "deadwood");
        assert_eq!(stump_lifecycle.stage, "decaying");
        assert_eq!(stump_lifecycle.species.as_deref(), Some("mossheart-fall"));
        assert_eq!(stump_lifecycle.age_years, Some(9));
        assert!(stump_lifecycle.health > 0.0 && stump_lifecycle.health < deadwood_lifecycle.health);

        let sapling = snapshot
            .objects
            .iter()
            .find(|object| object.id == "young-grove-sapling")
            .expect("generated sapling should be present");
        let sapling_lifecycle = sapling
            .lifecycle
            .as_ref()
            .expect("sapling should expose lifecycle");
        assert_eq!(sapling_lifecycle.family, "tree");
        assert_eq!(sapling_lifecycle.stage, "sapling");
        assert_eq!(sapling_lifecycle.species.as_deref(), Some("greenwood"));
        assert_eq!(sapling_lifecycle.age_years, Some(7));
        assert!(sapling_lifecycle.health > 0.6 && sapling_lifecycle.health <= 1.0);

        let mature_tree = snapshot
            .objects
            .iter()
            .find(|object| object.id == "mossheart-grove-tree")
            .expect("mature generated tree should be present");
        assert_eq!(mature_tree.kind, ObjectKind::SaplingTree);
        assert_eq!(mature_tree.resources[0].kind, ResourceKind::Wood);
        let mature_lifecycle = mature_tree
            .lifecycle
            .as_ref()
            .expect("mature tree should expose lifecycle");
        assert_eq!(mature_lifecycle.family, "tree");
        assert_eq!(mature_lifecycle.stage, "mature");
        assert_eq!(mature_lifecycle.species.as_deref(), Some("shadebark"));
        assert_eq!(mature_lifecycle.age_years, Some(64));
        assert!(mature_lifecycle.health > 0.55);

        let ancient_tree = snapshot
            .objects
            .iter()
            .find(|object| object.id == "ancient-ironleaf-tree")
            .expect("ancient generated tree should be present");
        assert_eq!(ancient_tree.kind, ObjectKind::SaplingTree);
        assert_eq!(ancient_tree.resources[0].kind, ResourceKind::Wood);
        let ancient_lifecycle = ancient_tree
            .lifecycle
            .as_ref()
            .expect("ancient tree should expose lifecycle");
        assert_eq!(ancient_lifecycle.family, "tree");
        assert_eq!(ancient_lifecycle.stage, "ancient");
        assert_eq!(ancient_lifecycle.species.as_deref(), Some("ironleaf"));
        assert_eq!(ancient_lifecycle.age_years, Some(183));
        assert!(ancient_lifecycle.health > 0.6);

        let stormroot_coil = snapshot
            .objects
            .iter()
            .find(|object| object.id == "stormroot-field-coil")
            .expect("stormroot coil should be present");
        assert_eq!(stormroot_coil.kind, ObjectKind::FieldCoil);
        assert_eq!(stormroot_coil.resources[0].kind, ResourceKind::Charge);
        assert_eq!(stormroot_coil.resources[0].amount, 1);
        let stormroot_lifecycle = stormroot_coil
            .lifecycle
            .as_ref()
            .expect("stormroot coil should expose lifecycle");
        assert_eq!(stormroot_lifecycle.family, "machine");
        assert_eq!(stormroot_lifecycle.stage, "sparking");
        assert_eq!(stormroot_lifecycle.species.as_deref(), Some("stormroot"));
        assert_eq!(stormroot_lifecycle.age_years, Some(4));

        let ruin = snapshot
            .objects
            .iter()
            .find(|object| object.id == "ancient-viaduct-ruin")
            .expect("ancient ruin should be present");
        assert_eq!(ruin.kind, ObjectKind::Ruin);
        assert_eq!(ruin.resources[0].kind, ResourceKind::Stone);
        assert_eq!(ruin.resources[0].amount, 2);
        let ruin_lifecycle = ruin
            .lifecycle
            .as_ref()
            .expect("ruin should expose lifecycle");
        assert_eq!(ruin_lifecycle.family, "mineral");
        assert_eq!(ruin_lifecycle.stage, "ancient-ruin");
        assert_eq!(
            ruin_lifecycle.species.as_deref(),
            Some("sunken-viaduct-stone")
        );
        assert_eq!(ruin_lifecycle.age_years, Some(128_000));
        assert!(ruin_lifecycle.decay > 0.5);
        assert!(ruin_lifecycle.health > 0.0 && ruin_lifecycle.health < 0.3);

        move_player_to_object(&mut sim, player_id, "fallen-grove-log", 8.0, 0.0);
        sim.set_input(
            player_id,
            PlayerInput {
                interact: true,
                ..PlayerInput::default()
            },
        );
        let outcome = sim.tick(0.05);
        assert_eq!(outcome.resource_events.len(), 1);
        assert_eq!(outcome.resource_events[0].resource, ResourceKind::Deadwood);
        assert_eq!(
            outcome.resource_node_events[0].object_id,
            "fallen-grove-log"
        );
        assert_eq!(outcome.resource_node_events[0].amount, 3);

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should remain in snapshot");
        assert_eq!(player.resources.deadwood, 1);
        assert!(player
            .inventory
            .items
            .iter()
            .any(|item| item.item_id == "deadwood" && item.label == "Deadwood"));

        sim.set_input(player_id, PlayerInput::default());
        let _ = sim.tick(0.05);
        move_player_to_object(&mut sim, player_id, "shrine-mycelium-bloom", 8.0, 0.0);
        sim.set_input(
            player_id,
            PlayerInput {
                interact: true,
                ..PlayerInput::default()
            },
        );
        let outcome = sim.tick(0.05);
        assert_eq!(outcome.resource_feed_events.len(), 1);
        assert_eq!(
            outcome.resource_feed_events[0].input_resource,
            ResourceKind::Deadwood
        );
        assert_eq!(
            outcome.resource_feed_events[0].output_resource,
            ResourceKind::Mycelium
        );
        assert_eq!(outcome.resource_feed_events[0].input_total, 0);
        assert_eq!(outcome.resource_feed_events[0].output_total, 4);
        assert_eq!(
            outcome.resource_node_events[0].object_id,
            "shrine-mycelium-bloom"
        );
        assert_eq!(outcome.resource_node_events[0].amount, 4);

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should remain in snapshot");
        assert_eq!(player.resources.deadwood, 0);
        let bloom = snapshot
            .objects
            .iter()
            .find(|object| object.id == "shrine-mycelium-bloom")
            .expect("mycelium bloom should remain in snapshot");
        assert_eq!(bloom.resources[0].amount, 4);
        assert_eq!(
            bloom
                .lifecycle
                .as_ref()
                .map(|lifecycle| lifecycle.stage.as_str()),
            Some("blooming")
        );

        sim.set_input(player_id, PlayerInput::default());
        let _ = sim.tick(0.05);
        move_player_to_object(&mut sim, player_id, "field-coil", 8.0, 0.0);
        sim.set_input(
            player_id,
            PlayerInput {
                interact: true,
                ..PlayerInput::default()
            },
        );
        let outcome = sim.tick(0.05);
        assert_eq!(outcome.resource_events.len(), 1);
        assert_eq!(outcome.resource_events[0].resource, ResourceKind::Charge);
        assert_eq!(outcome.resource_node_events[0].object_id, "field-coil");

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should remain in snapshot");
        assert_eq!(player.resources.charge, 1);
        assert!(player
            .inventory
            .items
            .iter()
            .any(|item| item.item_id == "charge" && item.label == "Charge"));
    }

    #[test]
    fn deadwood_near_mycelium_decays_into_bloom_growth() {
        let mut sim = SimWorld::new();
        let snapshot = sim.snapshot(empty_settlement());
        let stump = snapshot
            .objects
            .iter()
            .find(|object| object.id == "decaying-grove-stump")
            .expect("decaying stump should be present");
        let bloom = snapshot
            .objects
            .iter()
            .find(|object| object.id == "shrine-mycelium-bloom")
            .expect("mycelium bloom should be present");
        let hollow_stump = snapshot
            .objects
            .iter()
            .find(|object| object.id == "hollow-grove-stump")
            .expect("hollow stump should be present");
        let runner = snapshot
            .objects
            .iter()
            .find(|object| object.id == "veilcap-runner")
            .expect("veilcap runner should be present");
        assert_eq!(stump.resources[0].amount, 2);
        assert_eq!(bloom.resources[0].amount, 3);
        assert_eq!(hollow_stump.resources[0].amount, 1);
        assert_eq!(runner.resources[0].amount, 1);

        let mut last_outcome = SimTickOutcome::default();
        for _ in 0..ECOLOGY_DECAY_FEED_INTERVAL_TICKS {
            last_outcome = sim.tick(0.05);
        }

        assert_eq!(last_outcome.resource_events.len(), 0);
        assert_eq!(last_outcome.resource_feed_events.len(), 0);
        assert_eq!(last_outcome.resource_node_events.len(), 4);
        assert_node_event(
            &last_outcome.resource_node_events,
            "decaying-grove-stump",
            ResourceKind::Deadwood,
            1,
        );
        assert_node_event(
            &last_outcome.resource_node_events,
            "shrine-mycelium-bloom",
            ResourceKind::Mycelium,
            4,
        );
        assert_node_event(
            &last_outcome.resource_node_events,
            "hollow-grove-stump",
            ResourceKind::Deadwood,
            0,
        );
        assert_node_event(
            &last_outcome.resource_node_events,
            "veilcap-runner",
            ResourceKind::Mycelium,
            2,
        );

        let snapshot = sim.snapshot(empty_settlement());
        let stump = snapshot
            .objects
            .iter()
            .find(|object| object.id == "decaying-grove-stump")
            .expect("decaying stump should remain in snapshot");
        let bloom = snapshot
            .objects
            .iter()
            .find(|object| object.id == "shrine-mycelium-bloom")
            .expect("mycelium bloom should remain in snapshot");
        assert_eq!(stump.resources[0].amount, 1);
        assert_eq!(bloom.resources[0].amount, 4);
        let hollow_stump = snapshot
            .objects
            .iter()
            .find(|object| object.id == "hollow-grove-stump")
            .expect("hollow stump should remain in snapshot");
        let runner = snapshot
            .objects
            .iter()
            .find(|object| object.id == "veilcap-runner")
            .expect("veilcap runner should remain in snapshot");
        assert_eq!(hollow_stump.resources[0].amount, 0);
        assert_eq!(runner.resources[0].amount, 2);
        assert_eq!(
            bloom
                .lifecycle
                .as_ref()
                .map(|lifecycle| lifecycle.stage.as_str()),
            Some("blooming")
        );
    }

    #[test]
    fn mycelium_consumes_organic_inventory_items() {
        let mut sim = SimWorld::new();
        let player_id = Uuid::new_v4();
        sim.add_player(player_id);

        move_player_to_object(&mut sim, player_id, "young-grove-sapling", 8.0, 0.0);
        sim.set_input(
            player_id,
            PlayerInput {
                interact: true,
                ..PlayerInput::default()
            },
        );
        let outcome = sim.tick(0.05);
        assert_eq!(outcome.resource_events.len(), 1);
        assert_eq!(outcome.resource_events[0].resource, ResourceKind::Seed);
        assert_node_event(
            &outcome.resource_node_events,
            "young-grove-sapling",
            ResourceKind::Seed,
            0,
        );

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should remain in snapshot");
        assert_eq!(player.resources.seed, 1);
        assert!(player
            .inventory
            .items
            .iter()
            .any(|item| item.item_id == "seed" && item.label == "Seed"));

        sim.set_input(player_id, PlayerInput::default());
        let _ = sim.tick(0.05);
        move_player_to_object(&mut sim, player_id, "shrine-mycelium-bloom", 8.0, 0.0);
        sim.set_input(
            player_id,
            PlayerInput {
                interact: true,
                ..PlayerInput::default()
            },
        );
        let outcome = sim.tick(0.05);
        assert_eq!(outcome.resource_feed_events.len(), 1);
        assert_eq!(
            outcome.resource_feed_events[0].input_resource,
            ResourceKind::Seed
        );
        assert_eq!(outcome.resource_feed_events[0].input_total, 0);
        assert_eq!(
            outcome.resource_feed_events[0].output_resource,
            ResourceKind::Mycelium
        );
        assert_eq!(outcome.resource_feed_events[0].output_total, 4);
        assert_node_event(
            &outcome.resource_node_events,
            "shrine-mycelium-bloom",
            ResourceKind::Mycelium,
            4,
        );

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should remain in snapshot");
        assert_eq!(player.resources.seed, 0);
        let bloom = snapshot
            .objects
            .iter()
            .find(|object| object.id == "shrine-mycelium-bloom")
            .expect("mycelium bloom should remain in snapshot");
        assert_eq!(bloom.resources[0].amount, 4);
    }

    #[test]
    fn charged_field_coil_energizes_nearby_mycelium() {
        let mut sim = SimWorld::new();
        let mut states = HashMap::new();
        states.insert(
            "hollow-grove-stump".to_string(),
            (ResourceKind::Deadwood, 0),
        );
        assert_eq!(sim.apply_resource_node_replay(&states), 1);

        let snapshot = sim.snapshot(empty_settlement());
        let coil = snapshot
            .objects
            .iter()
            .find(|object| object.id == "stormroot-field-coil")
            .expect("stormroot coil should be present");
        let runner = snapshot
            .objects
            .iter()
            .find(|object| object.id == "veilcap-runner")
            .expect("veilcap runner should be present");
        assert_eq!(coil.resources[0].amount, 1);
        assert_eq!(runner.resources[0].amount, 1);

        let mut last_outcome = SimTickOutcome::default();
        for _ in 0..COIL_MYCELIUM_CHARGE_INTERVAL_TICKS {
            last_outcome = sim.tick(0.05);
        }

        assert_eq!(last_outcome.resource_events.len(), 0);
        assert_eq!(last_outcome.resource_feed_events.len(), 0);
        assert_node_event(
            &last_outcome.resource_node_events,
            "stormroot-field-coil",
            ResourceKind::Charge,
            0,
        );
        assert_node_event(
            &last_outcome.resource_node_events,
            "veilcap-runner",
            ResourceKind::Mycelium,
            2,
        );

        let snapshot = sim.snapshot(empty_settlement());
        let coil = snapshot
            .objects
            .iter()
            .find(|object| object.id == "stormroot-field-coil")
            .expect("stormroot coil should remain in snapshot");
        let runner = snapshot
            .objects
            .iter()
            .find(|object| object.id == "veilcap-runner")
            .expect("veilcap runner should remain in snapshot");
        assert_eq!(coil.resources[0].amount, 0);
        assert_eq!(
            coil.lifecycle
                .as_ref()
                .map(|lifecycle| lifecycle.stage.as_str()),
            Some("spent")
        );
        assert_eq!(runner.resources[0].amount, 2);
        assert_eq!(
            runner
                .lifecycle
                .as_ref()
                .map(|lifecycle| lifecycle.stage.as_str()),
            Some("fruiting")
        );
    }

    #[test]
    fn resource_node_replay_restores_depleted_world_state() {
        let mut states = HashMap::new();
        states.insert("north-grove".to_string(), (ResourceKind::Wood, 3));
        states.insert("old-shrine".to_string(), (ResourceKind::Mycelium, 2));
        states.insert("fallen-grove-log".to_string(), (ResourceKind::Deadwood, 1));
        states.insert("field-coil".to_string(), (ResourceKind::Charge, 2));
        states.insert("east-ore".to_string(), (ResourceKind::Wood, 1));
        states.insert("missing-node".to_string(), (ResourceKind::Ore, 1));

        let mut sim = SimWorld::new();
        assert_eq!(sim.apply_resource_node_replay(&states), 4);

        let snapshot = sim.snapshot(empty_settlement());
        let grove = snapshot
            .objects
            .iter()
            .find(|object| object.id == "north-grove")
            .expect("grove should be present");
        assert_eq!(grove.resources[0].amount, 3);
        assert_eq!(grove.resources[0].max_amount, 12);

        let shrine = snapshot
            .objects
            .iter()
            .find(|object| object.id == "old-shrine")
            .expect("shrine should be present");
        assert_eq!(shrine.resources[0].amount, 2);

        let ore = snapshot
            .objects
            .iter()
            .find(|object| object.id == "east-ore")
            .expect("ore should be present");
        assert_eq!(
            ore.resources[0].amount, 6,
            "replay with the wrong resource kind should not mutate the node"
        );

        let deadwood = snapshot
            .objects
            .iter()
            .find(|object| object.id == "fallen-grove-log")
            .expect("generated deadwood should be present");
        assert_eq!(deadwood.resources[0].amount, 1);

        let field_coil = snapshot
            .objects
            .iter()
            .find(|object| object.id == "field-coil")
            .expect("field coil should be present");
        assert_eq!(field_coil.resources[0].kind, ResourceKind::Charge);
        assert_eq!(field_coil.resources[0].amount, 2);
    }

    #[test]
    fn inventory_resource_stacks_are_bounded() {
        let mut inventory = PlayerInventory::default();
        assert_eq!(
            inventory.add_resource(ResourceKind::Wood, INVENTORY_STACK_LIMIT - 1),
            Some(INVENTORY_STACK_LIMIT - 1)
        );
        assert_eq!(
            inventory.add_resource(ResourceKind::Wood, 10),
            Some(INVENTORY_STACK_LIMIT)
        );
        assert_eq!(inventory.add_resource(ResourceKind::Wood, 1), None);

        let snapshot = inventory.snapshot();
        assert_eq!(snapshot.items.len(), 1);
        assert_eq!(snapshot.items[0].item_id, "wood");
        assert_eq!(snapshot.items[0].quantity, INVENTORY_STACK_LIMIT);
    }

    #[test]
    fn crafting_near_forge_consumes_resources_and_adds_crafted_item() {
        let player_id = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player(player_id);

        let entity = sim.players.get(&player_id).copied().expect("player exists");
        {
            let mut player = sim
                .world
                .get_mut::<Player>(entity)
                .expect("player component");
            assert_eq!(
                player.inventory.add_resource(ResourceKind::Wood, 1),
                Some(1)
            );
            assert_eq!(player.inventory.add_resource(ResourceKind::Ore, 1), Some(1));
        }
        move_player_to_object(&mut sim, player_id, "field-forge", 8.0, 0.0);

        sim.set_input(
            player_id,
            PlayerInput {
                interact: true,
                ..PlayerInput::default()
            },
        );
        let outcome = sim.tick(0.05);

        assert!(outcome.settlement_jobs.is_empty());
        assert!(outcome.resource_events.is_empty());
        assert_eq!(outcome.crafting_events.len(), 1);
        assert_eq!(outcome.crafting_events[0].player_id, player_id);
        assert_eq!(outcome.crafting_events[0].object_id, "field-forge");
        assert_eq!(outcome.crafting_events[0].item_id, "trail-kit");
        assert_eq!(outcome.crafting_events[0].amount, 1);
        assert_eq!(outcome.crafting_events[0].total, 1);

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should remain in snapshot");
        assert_eq!(player.resources.wood, 0);
        assert_eq!(player.resources.ore, 0);
        assert_eq!(player.inventory.items.len(), 1);
        assert_eq!(player.inventory.items[0].item_id, "trail-kit");
        assert_eq!(player.inventory.items[0].label, "Trail Kit");
        assert_eq!(player.inventory.items[0].quantity, 1);
    }

    #[test]
    fn crafting_without_recipe_resources_does_not_mint_items() {
        let player_id = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player(player_id);
        move_player_to_object(&mut sim, player_id, "field-forge", 8.0, 0.0);

        sim.set_input(
            player_id,
            PlayerInput {
                interact: true,
                ..PlayerInput::default()
            },
        );
        let outcome = sim.tick(0.05);

        assert!(outcome.settlement_jobs.is_empty());
        assert!(outcome.resource_events.is_empty());
        assert!(outcome.crafting_events.is_empty());

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should remain in snapshot");
        assert!(player.inventory.items.is_empty());
        assert_eq!(player.resources.wood, 0);
        assert_eq!(player.resources.ore, 0);
    }

    #[test]
    fn player_snapshot_color_matches_client_hex_contract() {
        let player_id = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player(player_id);

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should remain in snapshot");

        assert_eq!(player.color.len(), 7);
        assert!(player.color.starts_with('#'));
        assert!(player.color[1..].chars().all(|ch| ch.is_ascii_hexdigit()));
    }

    #[test]
    fn interaction_far_from_objects_does_not_mutate_resources_or_settlement() {
        let player_id = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player(player_id);
        let entity = sim.players.get(&player_id).copied().expect("player exists");
        let mut position = sim
            .world
            .get_mut::<Position>(entity)
            .expect("player position");
        position.x = 40.0;
        position.y = 40.0;

        sim.set_input(
            player_id,
            PlayerInput {
                interact: true,
                ..PlayerInput::default()
            },
        );
        let outcome = sim.tick(0.05);
        assert!(outcome.settlement_jobs.is_empty());
        assert!(outcome.resource_events.is_empty());
        assert!(outcome.crafting_events.is_empty());

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should remain in snapshot");
        assert_eq!(player.demo_deeds.len(), 0);
        assert_eq!(player.resources.wood, 0);
        assert_eq!(player.resources.ore, 0);
    }

    #[test]
    fn object_positions_are_indexed_by_content_id() {
        let sim = SimWorld::new();
        let registrar_position = sim
            .object_position("registrar")
            .expect("registrar should be indexed");
        assert_eq!(registrar_position.x, 900.0);
        assert_eq!(registrar_position.y, 520.0);
        assert!(sim.object_position("missing-object").is_none());
    }

    #[test]
    fn player_snapshot_filters_distant_players_and_keeps_self() {
        let near_player = Uuid::new_v4();
        let far_player = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player(near_player);
        sim.add_player(far_player);

        let far_entity = sim.players.get(&far_player).copied().expect("far player");
        let mut far_position = sim
            .world
            .get_mut::<Position>(far_entity)
            .expect("far position");
        far_position.x = sim.map.width - 40.0;
        far_position.y = sim.map.height - 40.0;

        let snapshot = sim.snapshot_for_player(near_player, empty_settlement(), INTEREST_RADIUS);
        assert!(snapshot
            .players
            .iter()
            .any(|player| player.id == near_player));
        assert!(!snapshot
            .players
            .iter()
            .any(|player| player.id == far_player));
    }

    #[test]
    fn player_snapshot_uses_configured_interest_radius() {
        let player_a = Uuid::new_v4();
        let player_b = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player(player_a);
        sim.add_player(player_b);

        let tight = sim.snapshot_for_player(player_a, empty_settlement(), 20.0);
        assert!(tight.players.iter().any(|player| player.id == player_a));
        assert!(!tight.players.iter().any(|player| player.id == player_b));

        let wider = sim.snapshot_for_player(player_a, empty_settlement(), 80.0);
        assert!(wider.players.iter().any(|player| player.id == player_a));
        assert!(wider.players.iter().any(|player| player.id == player_b));
    }

    #[test]
    fn validates_player_names_explicitly() {
        assert_eq!(
            validate_player_name("  Wayfarer_7  ").expect("valid name"),
            "Wayfarer_7"
        );
        assert_eq!(validate_player_name("   "), Err(PlayerNameError::Empty));
        assert_eq!(
            validate_player_name("Wayfarer With Space"),
            Err(PlayerNameError::InvalidCharacters)
        );
        assert_eq!(
            validate_player_name("Wayfarer<script>"),
            Err(PlayerNameError::InvalidCharacters)
        );
        assert_eq!(
            validate_player_name("ABCDEFGHIJKLMNOPQRSTU"),
            Err(PlayerNameError::TooLong {
                max: PLAYER_NAME_MAX_CHARS,
            })
        );
    }

    #[test]
    fn rename_player_rejects_invalid_names_without_mutating_snapshot() {
        let player_id = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player(player_id);

        assert_eq!(
            sim.rename_player(player_id, "Good_Name-7")
                .expect("valid rename"),
            Some("Good_Name-7".to_string())
        );
        assert_eq!(
            sim.rename_player(player_id, "<bad>"),
            Err(PlayerNameError::InvalidCharacters)
        );

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should remain in snapshot");
        assert_eq!(player.name, "Good_Name-7");
    }

    #[test]
    fn player_can_spawn_with_prevalidated_display_name() {
        let player_id = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player_with_display_name(player_id, Some("Scout_7".to_string()))
            .expect("display name accepted");

        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_id)
            .expect("player should be in snapshot");
        assert_eq!(player.name, "Scout_7");
    }

    #[test]
    fn active_player_names_are_unique_case_insensitively() {
        let player_a = Uuid::new_v4();
        let player_b = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player_with_display_name(player_a, Some("Scout_7".to_string()))
            .expect("first player name accepted");

        assert_eq!(
            sim.add_player_with_display_name(player_b, Some("scout_7".to_string())),
            Err(PlayerNameError::Taken)
        );
        sim.add_player(player_b);
        assert_eq!(
            sim.rename_player(player_b, "SCOUT_7"),
            Err(PlayerNameError::Taken)
        );
        assert_eq!(
            sim.rename_player(player_a, "scout_7")
                .expect("own case-only rename accepted"),
            Some("scout_7".to_string())
        );
    }

    #[test]
    fn removed_player_name_becomes_available() {
        let player_a = Uuid::new_v4();
        let player_b = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player_with_display_name(player_a, Some("Scout_7".to_string()))
            .expect("first player name accepted");

        sim.remove_player(player_a);

        sim.add_player_with_display_name(player_b, Some("scout_7".to_string()))
            .expect("removed player name should be reusable");
        let snapshot = sim.snapshot(empty_settlement());
        let player = snapshot
            .players
            .iter()
            .find(|player| player.id == player_b)
            .expect("second player should be in snapshot");
        assert_eq!(player.name, "scout_7");
    }

    #[test]
    fn rename_player_updates_active_name_index() {
        let player_a = Uuid::new_v4();
        let player_b = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player_with_display_name(player_a, Some("Scout_7".to_string()))
            .expect("first player name accepted");
        sim.rename_player(player_a, "Ranger_7")
            .expect("rename should be valid");

        sim.add_player_with_display_name(player_b, Some("scout_7".to_string()))
            .expect("old name should be released after rename");
        assert_eq!(
            sim.rename_player(player_b, "RANGER_7"),
            Err(PlayerNameError::Taken)
        );
    }

    #[test]
    fn diagonal_movement_is_not_faster_than_cardinal_movement() {
        let cardinal_player = Uuid::new_v4();
        let diagonal_player = Uuid::new_v4();

        let mut cardinal = SimWorld::new();
        cardinal.add_player(cardinal_player);
        cardinal.set_input(
            cardinal_player,
            PlayerInput {
                right: true,
                ..PlayerInput::default()
            },
        );
        let cardinal_start = player_position(&cardinal, cardinal_player);
        cardinal.tick(1.0);
        let cardinal_end = player_position(&cardinal, cardinal_player);

        let mut diagonal = SimWorld::new();
        diagonal.add_player(diagonal_player);
        diagonal.set_input(
            diagonal_player,
            PlayerInput {
                right: true,
                down: true,
                ..PlayerInput::default()
            },
        );
        let diagonal_start = player_position(&diagonal, diagonal_player);
        diagonal.tick(1.0);
        let diagonal_end = player_position(&diagonal, diagonal_player);

        assert!((travel_distance(cardinal_start, cardinal_end) - PLAYER_SPEED).abs() < 0.01);
        assert!((travel_distance(diagonal_start, diagonal_end) - PLAYER_SPEED).abs() < 0.01);
    }

    #[test]
    fn world_objects_block_authoritative_movement() {
        let player_id = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player(player_id);
        let registrar = sim.object_position("registrar").expect("registrar exists");
        let registrar_radius = object_solid_radius(54.0);
        let start = Position {
            x: registrar.x - registrar_radius - PLAYER_COLLISION_RADIUS - 6.0,
            y: registrar.y,
        };
        move_player_to_position(&mut sim, player_id, start);

        sim.set_input(
            player_id,
            PlayerInput {
                right: true,
                ..PlayerInput::default()
            },
        );
        sim.tick(0.1);
        let after = player_position(&sim, player_id);

        assert!((after.x - start.x).abs() < 0.01);
        assert!((after.y - start.y).abs() < 0.01);
    }

    #[test]
    fn overlapped_world_object_allows_movement_away() {
        let player_id = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player(player_id);
        let registrar = sim.object_position("registrar").expect("registrar exists");
        let start = Position {
            x: registrar.x - 10.0,
            y: registrar.y,
        };
        move_player_to_position(&mut sim, player_id, start);

        sim.set_input(
            player_id,
            PlayerInput {
                left: true,
                ..PlayerInput::default()
            },
        );
        sim.tick(0.1);
        let after = player_position(&sim, player_id);

        assert!(after.x < start.x - 1.0);
        assert!((after.y - start.y).abs() < 0.01);
    }

    #[test]
    fn terrain_detail_authority_blocks_authoritative_movement() {
        let player_id = Uuid::new_v4();
        let authority = test_terrain_detail_authority(TerrainDetailAuthorityBlocker {
            id: "test-tree-blocker".to_string(),
            x: 760.0,
            y: 550.0,
            collision: TerrainDetailAuthorityCollision {
                blocks_movement: true,
                shape: "aabb".to_string(),
                width_tiles: 1.0,
                height_tiles: 1.0,
            },
        });
        let mut sim = SimWorld::from_content_with_terrain_detail_authority(
            WorldContent::demo(),
            Some(authority),
        )
        .expect("test terrain detail authority should load");
        sim.add_player(player_id);
        let start = Position {
            x: 760.0 + 32.0 + PLAYER_COLLISION_RADIUS + 4.0,
            y: 550.0,
        };
        move_player_to_position(&mut sim, player_id, start);

        sim.set_input(
            player_id,
            PlayerInput {
                left: true,
                ..PlayerInput::default()
            },
        );
        sim.tick(0.1);
        let after = player_position(&sim, player_id);

        assert!((after.x - start.x).abs() < 0.01);
        assert!((after.y - start.y).abs() < 0.01);
    }

    #[test]
    fn overlapped_terrain_detail_authority_allows_movement_away() {
        let player_id = Uuid::new_v4();
        let authority = test_terrain_detail_authority(TerrainDetailAuthorityBlocker {
            id: "test-tree-blocker".to_string(),
            x: 760.0,
            y: 550.0,
            collision: TerrainDetailAuthorityCollision {
                blocks_movement: true,
                shape: "aabb".to_string(),
                width_tiles: 1.0,
                height_tiles: 1.0,
            },
        });
        let mut sim = SimWorld::from_content_with_terrain_detail_authority(
            WorldContent::demo(),
            Some(authority),
        )
        .expect("test terrain detail authority should load");
        sim.add_player(player_id);
        let start = Position { x: 748.0, y: 550.0 };
        move_player_to_position(&mut sim, player_id, start);

        sim.set_input(
            player_id,
            PlayerInput {
                left: true,
                ..PlayerInput::default()
            },
        );
        sim.tick(0.1);
        let after = player_position(&sim, player_id);

        assert!(after.x < start.x - 1.0);
        assert!((after.y - start.y).abs() < 0.01);
    }

    #[test]
    fn terrain_water_blocks_authoritative_movement() {
        let player_id = Uuid::new_v4();
        let mut sim = SimWorld::new();
        sim.add_player(player_id);
        let (from, blocked_target) = water_blocking_route(&sim);
        move_player_to_position(&mut sim, player_id, from);

        sim.set_input(
            player_id,
            PlayerInput {
                right: true,
                ..PlayerInput::default()
            },
        );
        sim.tick((blocked_target.x - from.x) / PLAYER_SPEED);
        let after = player_position(&sim, player_id);

        assert_eq!(
            sim.terrain
                .material_at_world(blocked_target.x, blocked_target.y),
            TerrainMaterial::Water
        );
        assert!(after.x < blocked_target.x - 1.0);
        assert!((after.y - from.y).abs() < 0.01);
    }

    fn player_position(sim: &SimWorld, player_id: PlayerId) -> Position {
        let entity = sim.players.get(&player_id).copied().expect("player exists");
        *sim.world
            .get::<Position>(entity)
            .expect("player has position")
    }

    fn move_player_to_object(
        sim: &mut SimWorld,
        player_id: PlayerId,
        object_id: &str,
        dx: f32,
        dy: f32,
    ) {
        let object_position = sim.object_position(object_id).expect("object exists");
        let entity = sim.players.get(&player_id).copied().expect("player exists");
        let mut position = sim
            .world
            .get_mut::<Position>(entity)
            .expect("player position");
        position.x = object_position.x + dx;
        position.y = object_position.y + dy;
        sim.player_index.insert_or_update(
            entity,
            Point {
                x: position.x,
                y: position.y,
            },
        );
    }

    fn move_player_to_position(sim: &mut SimWorld, player_id: PlayerId, target: Position) {
        let entity = sim.players.get(&player_id).copied().expect("player exists");
        let mut position = sim
            .world
            .get_mut::<Position>(entity)
            .expect("player position");
        position.x = target.x;
        position.y = target.y;
        sim.player_index.insert_or_update(
            entity,
            Point {
                x: position.x,
                y: position.y,
            },
        );
    }

    fn water_blocking_route(sim: &SimWorld) -> (Position, Position) {
        for y in (64..(sim.map.height as i32 - 64)).step_by(16) {
            for x in (64..(sim.map.width as i32 - 256)).step_by(16) {
                let from = Position {
                    x: x as f32,
                    y: y as f32,
                };
                let to = Position {
                    x: x as f32 + PLAYER_SPEED,
                    y: y as f32,
                };
                if sim.terrain.is_walkable_at_world(from.x, from.y)
                    && sim.terrain.material_at_world(to.x, to.y) == TerrainMaterial::Water
                    && !sim.terrain.allows_step(from.x, from.y, to.x, to.y)
                {
                    return (from, to);
                }
            }
        }
        panic!("expected demo terrain to include a horizontal walkable-to-water route");
    }

    fn test_terrain_detail_authority(
        blocker: TerrainDetailAuthorityBlocker,
    ) -> TerrainDetailAuthority {
        TerrainDetailAuthority {
            schema_version: "duskfell-terrain-detail-authority-v1".to_string(),
            projection: "military-plan-oblique".to_string(),
            profile: "duskfell-terrain-v1".to_string(),
            units_per_tile: 64,
            blockers: vec![blocker],
        }
    }

    fn travel_distance(start: Position, end: Position) -> f32 {
        ((end.x - start.x).powi(2) + (end.y - start.y).powi(2)).sqrt()
    }
}
