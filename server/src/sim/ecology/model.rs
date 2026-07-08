use bevy_ecs::prelude::Entity;

use crate::protocol::ResourceKind;

use crate::sim::Position;

pub(in crate::sim::ecology) const TREE_HARVEST_FALLOUT_AMOUNT: u32 = 1;
pub(in crate::sim::ecology) const TREE_HARVEST_FALLOUT_RADIUS: f32 = 140.0;
pub(in crate::sim) const ECOLOGY_DECAY_FEED_INTERVAL_TICKS: u64 = 20;
pub(in crate::sim::ecology) const ECOLOGY_DECAY_FEED_RADIUS: f32 = 96.0;
pub(in crate::sim) const COIL_MYCELIUM_CHARGE_INTERVAL_TICKS: u64 = 30;
pub(in crate::sim::ecology) const COIL_MYCELIUM_CHARGE_RADIUS: f32 = 120.0;

#[derive(Debug, Clone)]
pub(in crate::sim::ecology) struct EcologyFeedCandidate {
    pub entity: Entity,
    pub object_id: String,
    pub position: Position,
    pub resource: ResourceKind,
}
