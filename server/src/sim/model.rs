use std::collections::HashMap;
use std::f32::consts::FRAC_1_SQRT_2;

use bevy_ecs::prelude::*;

use crate::protocol::{ObjectKind, PlayerId, ResourceKind, TerrainSnapshot};
use crate::settlement::SettlementJob;
use crate::spatial::{Point, SpatialIndex};
use crate::terrain::TerrainAuthority;

use super::crafting::ItemCraftedEvent;
use super::interactions::{ItemFedEvent, ResourceFedEvent, ResourceGatheredEvent};
use super::inventory::PlayerInventory;
use super::movement::MovementBlocker;
use super::resources::ResourceNode;
use super::terrain_authority::ResourceRequirement;

pub(super) const PLAYER_SPEED: f32 = 220.0;
pub(super) const PLAYER_COLLISION_RADIUS: f32 = 18.0;
pub(super) const OBJECT_SOLID_RADIUS_SCALE: f32 = 0.45;
pub(super) const INTERACT_RADIUS: f32 = 64.0;
pub(super) const RESOURCE_GATHER_AMOUNT: u32 = 1;
pub(super) const MAX_LIFECYCLE_AGE_YEARS: u32 = 1_000_000;
pub const INTEREST_RADIUS: f32 = 520.0;
pub(super) const SPATIAL_CELL_SIZE: f32 = 256.0;
pub(super) const SPAWN_SLOT_BASE_RADIUS: f32 = 92.0;
pub(super) const SPAWN_SLOT_RING_STEP: f32 = 58.0;
pub(super) const SPAWN_SLOT_COUNT: usize = 16;
pub(super) const SPAWN_SLOT_MAX_RINGS: usize = 4;
pub(super) const SPAWN_PLAYER_SEPARATION: f32 = PLAYER_COLLISION_RADIUS * 2.0 + 22.0;
pub(super) const SPAWN_SAFE_MARGIN: f32 = PLAYER_COLLISION_RADIUS + 10.0;

#[derive(Component, Debug, Clone, Copy)]
pub(super) struct Position {
    pub(super) x: f32,
    pub(super) y: f32,
}

#[derive(Component, Debug, Clone, Copy, Default)]
pub(super) struct Velocity {
    pub(super) x: f32,
    pub(super) y: f32,
}

#[derive(Component, Debug, Clone)]
pub(super) struct Player {
    pub(super) id: PlayerId,
    pub(super) account_subject: Option<String>,
    pub(super) name: String,
    pub(super) color: String,
    pub(super) demo_deeds: Vec<String>,
    pub(super) inventory: PlayerInventory,
    pub(super) speech: Option<PlayerSpeech>,
}

// UO-style overhead speech: the latest line and the tick it stops showing
#[derive(Debug, Clone)]
pub(super) struct PlayerSpeech {
    pub(super) text: String,
    pub(super) until_tick: u64,
}

#[derive(Component, Debug, Clone)]
pub(super) struct WorldObject {
    pub(super) id: String,
    pub(super) kind: ObjectKind,
    pub(super) label: String,
    pub(super) radius: f32,
    pub(super) resource_node: Option<ResourceNode>,
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
    pub item_feed_events: Vec<ItemFedEvent>,
    pub item_decay_events: Vec<ItemDecayedEvent>,
    pub resource_node_events: Vec<ResourceNodeChangedEvent>,
    pub crafting_events: Vec<ItemCraftedEvent>,
}

#[derive(Debug, Clone)]
pub struct ResourceNodeChangedEvent {
    pub object_id: String,
    pub resource: ResourceKind,
    pub amount: u32,
    pub max_amount: u32,
}

#[derive(Debug, Clone)]
pub struct ItemDecayedEvent {
    pub player_id: PlayerId,
    pub target_object_id: Option<String>,
    pub item_id: String,
    pub item_label: String,
    pub item_stage: String,
    pub output_resource: ResourceKind,
    pub output_amount: u32,
    pub output_total: u32,
}

#[derive(Debug, Clone)]
pub(super) struct MapBounds {
    pub(super) width: f32,
    pub(super) height: f32,
    pub(super) safe_zone_radius: f32,
    pub(super) terrain_snapshot: TerrainSnapshot,
    pub(super) spawn: Position,
}

#[derive(Debug)]
pub struct SimWorld {
    pub(super) world: World,
    pub(super) tick: u64,
    pub(super) map: MapBounds,
    pub(super) players: HashMap<PlayerId, Entity>,
    pub(super) inputs: HashMap<PlayerId, PlayerInput>,
    pub(super) interact_latches: HashMap<PlayerId, bool>,
    pub(super) player_name_index: HashMap<String, PlayerId>,
    pub(super) player_index: SpatialIndex<Entity>,
    pub(super) object_entities: HashMap<String, Entity>,
    pub(super) object_index: SpatialIndex<Entity>,
    pub(super) max_object_radius: f32,
    pub(super) terrain: TerrainAuthority,
    pub(super) terrain_detail_blockers: Vec<MovementBlocker>,
    pub(super) terrain_detail_decay_consumers: HashMap<String, Vec<ResourceRequirement>>,
}

#[derive(Debug)]
pub(super) struct GatherTarget {
    pub(super) entity: Entity,
    pub(super) object_id: String,
    pub(super) resource: ResourceKind,
    pub(super) position: Position,
    pub(super) distance: f32,
}

pub(super) fn axis(negative: bool, positive: bool) -> f32 {
    match (negative, positive) {
        (true, false) => -1.0,
        (false, true) => 1.0,
        _ => 0.0,
    }
}

pub(super) fn movement_scale(horizontal: f32, vertical: f32) -> f32 {
    if horizontal != 0.0 && vertical != 0.0 {
        FRAC_1_SQRT_2
    } else {
        1.0
    }
}

pub(super) fn point_from_position(position: Position) -> Point {
    Point {
        x: position.x,
        y: position.y,
    }
}
