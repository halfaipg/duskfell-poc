use serde::Deserialize;

use crate::protocol::{ObjectKind, ResourceKind};

use super::super::resources::ResourceNode;

pub(in crate::sim) const TERRAIN_DETAIL_RESOURCE_NODE_CAP: usize = 256;
pub(in crate::sim) const TERRAIN_DETAIL_DECAY_CONSUMER_CAP: usize = 128;
pub(in crate::sim) const TERRAIN_DETAIL_DECAY_CONSUME_AMOUNT_CAP: u32 = 4;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainDetailAuthority {
    pub(in crate::sim) schema_version: String,
    pub(in crate::sim) projection: String,
    pub(in crate::sim) profile: String,
    pub(in crate::sim) units_per_tile: u32,
    pub(in crate::sim) blockers: Vec<TerrainDetailAuthorityBlocker>,
    #[serde(default)]
    pub(in crate::sim) resource_nodes: Vec<TerrainDetailAuthorityResourceNode>,
    #[serde(default)]
    pub(in crate::sim) decay_consumers: Vec<TerrainDetailAuthorityDecayConsumer>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::sim) struct TerrainDetailAuthorityBlocker {
    pub(in crate::sim) id: String,
    pub(in crate::sim) x: f32,
    pub(in crate::sim) y: f32,
    pub(in crate::sim) collision: TerrainDetailAuthorityCollision,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::sim) struct TerrainDetailAuthorityCollision {
    pub(in crate::sim) blocks_movement: bool,
    pub(in crate::sim) shape: String,
    pub(in crate::sim) width_tiles: f32,
    pub(in crate::sim) height_tiles: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::sim) struct TerrainDetailAuthorityResourceNode {
    pub(in crate::sim) id: String,
    pub(in crate::sim) resource_node_id: String,
    pub(in crate::sim) kind: String,
    pub(in crate::sim) x: f32,
    pub(in crate::sim) y: f32,
    #[serde(default)]
    pub(in crate::sim) resources: Vec<TerrainDetailAuthorityResource>,
    pub(in crate::sim) lifecycle: Option<TerrainDetailAuthorityLifecycle>,
    pub(in crate::sim) kit_id: Option<String>,
    pub(in crate::sim) kit_kind: Option<String>,
    #[serde(default = "default_terrain_detail_kit_role")]
    pub(in crate::sim) kit_role: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::sim) struct TerrainDetailAuthorityResource {
    pub(in crate::sim) kind: ResourceKind,
    pub(in crate::sim) amount: u32,
    pub(in crate::sim) max_amount: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::sim) struct TerrainDetailAuthorityDecayConsumer {
    pub(in crate::sim) id: String,
    pub(in crate::sim) x: f32,
    pub(in crate::sim) y: f32,
    #[serde(default)]
    pub(in crate::sim) consumes: Vec<TerrainDetailAuthorityConsumeRequirement>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::sim) struct TerrainDetailAuthorityConsumeRequirement {
    pub(in crate::sim) kind: ResourceKind,
    pub(in crate::sim) amount: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::sim) struct TerrainDetailAuthorityLifecycle {
    pub(in crate::sim) family: Option<String>,
    pub(in crate::sim) stage: Option<String>,
    pub(in crate::sim) species: Option<String>,
    pub(in crate::sim) age_years: Option<u32>,
    pub(in crate::sim) health: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::sim) struct ResourceRequirement {
    pub(in crate::sim) resource: ResourceKind,
    pub(in crate::sim) amount: u32,
}

pub(in crate::sim) struct TerrainDetailResourceObject {
    pub(in crate::sim) id: String,
    pub(in crate::sim) kind: ObjectKind,
    pub(in crate::sim) label: String,
    pub(in crate::sim) x: f32,
    pub(in crate::sim) y: f32,
    pub(in crate::sim) radius: f32,
    pub(in crate::sim) resource_node: ResourceNode,
}

fn default_terrain_detail_kit_role() -> String {
    "none".to_string()
}
