use std::collections::HashMap;
use std::f32::consts::FRAC_1_SQRT_2;

use bevy_ecs::prelude::*;
use uuid::Uuid;

use crate::content::WorldContent;
use crate::protocol::{
    InventoryItemSnapshot, InventorySnapshot, MapSnapshot, ObjectKind, ObjectSnapshot, PlayerId,
    PlayerSnapshot, ResourceKind, ResourceSnapshot, SettlementSnapshot, TerrainSnapshot,
    WorldSnapshot,
};
use crate::settlement::SettlementJob;
use crate::spatial::{Point, SpatialIndex};
use crate::terrain::TerrainAuthority;

const PLAYER_SPEED: f32 = 220.0;
const INTERACT_RADIUS: f32 = 64.0;
const RESOURCE_GATHER_AMOUNT: u32 = 1;
const TRAIL_KIT_RECIPE: &[(ResourceKind, u32)] = &[(ResourceKind::Wood, 1), (ResourceKind::Ore, 1)];
const INVENTORY_CAPACITY_SLOTS: u8 = 8;
const INVENTORY_STACK_LIMIT: u32 = 999;
pub const INTEREST_RADIUS: f32 = 520.0;
pub const PLAYER_NAME_MAX_CHARS: usize = 20;
const SPATIAL_CELL_SIZE: f32 = 256.0;

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
}

impl SimWorld {
    #[cfg(test)]
    pub fn new() -> Self {
        Self::from_content(WorldContent::demo())
    }

    pub fn from_content(content: WorldContent) -> Self {
        let mut world = World::new();
        let terrain_snapshot = content
            .map
            .terrain
            .expect("validated world content includes terrain")
            .snapshot();
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

        Self {
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
        }
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
            if self
                .terrain
                .allows_step(position.x, position.y, candidate.x, candidate.y)
            {
                position.x = candidate.x;
                position.y = candidate.y;
            } else if self
                .terrain
                .allows_step(position.x, position.y, candidate.x, position.y)
            {
                position.x = candidate.x;
            } else if self
                .terrain
                .allows_step(position.x, position.y, position.x, candidate.y)
            {
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
            } else if let Some(event) = self.try_gather_resource(id, entity) {
                outcome.resource_events.push(event);
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
    ) -> Option<ResourceGatheredEvent> {
        let player_position = *self.world.get::<Position>(player_entity)?;
        let target = self.nearest_gatherable(player_position)?;
        let mut player = self.world.get_mut::<Player>(player_entity)?;

        let total = player
            .inventory
            .add_resource(target.resource, RESOURCE_GATHER_AMOUNT)?;

        Some(ResourceGatheredEvent {
            player_id,
            object_id: target.object_id,
            resource: target.resource,
            amount: RESOURCE_GATHER_AMOUNT,
            total,
        })
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
                let resource = resource_for_object(&object.kind)?;
                let distance = distance(player_position, *position);
                if distance > INTERACT_RADIUS {
                    return None;
                }
                Some(GatherTarget {
                    object_id: object.id.clone(),
                    resource,
                    distance,
                })
            })
            .min_by(|a, b| a.distance.total_cmp(&b.distance))
    }

    fn object_position(&self, id: &str) -> Option<Position> {
        self.object_entities
            .get(id)
            .and_then(|entity| self.world.get::<Position>(*entity).copied())
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
    object_id: String,
    resource: ResourceKind,
    distance: f32,
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
                kind,
                label: label.to_string(),
                radius,
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
        },
        inventory: player.inventory.snapshot(),
    }
}

fn object_snapshot(object: &WorldObject, position: &Position) -> ObjectSnapshot {
    ObjectSnapshot {
        id: object.id.clone(),
        kind: object.kind.clone(),
        label: object.label.clone(),
        x: position.x,
        y: position.y,
        radius: object.radius,
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

fn distance(a: Position, b: Position) -> f32 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

fn resource_for_object(kind: &ObjectKind) -> Option<ResourceKind> {
    match kind {
        ObjectKind::Grove => Some(ResourceKind::Wood),
        ObjectKind::Ore => Some(ResourceKind::Ore),
        ObjectKind::Registrar | ObjectKind::Forge | ObjectKind::Shrine => None,
    }
}

fn resource_item_id(resource: ResourceKind) -> &'static str {
    match resource {
        ResourceKind::Wood => "wood",
        ResourceKind::Ore => "ore",
    }
}

fn resource_label(resource: ResourceKind) -> &'static str {
    match resource {
        ResourceKind::Wood => "Wood",
        ResourceKind::Ore => "Ore",
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

    fn travel_distance(start: Position, end: Position) -> f32 {
        ((end.x - start.x).powi(2) + (end.y - start.y).powi(2)).sqrt()
    }
}
