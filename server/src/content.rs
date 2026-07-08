use std::fs;
use std::path::Path;

use anyhow::Context;
use serde::Deserialize;

use crate::protocol::{ObjectKind, TerrainSnapshot};

mod hash;
mod validation;

#[cfg(test)]
mod tests;

use self::hash::stable_content_hash;

pub const WORLD_SCHEMA_VERSION: &str = "sundermere-world-v1";
pub const TERRAIN_PROFILE: &str = "duskfell-terrain-v1";
pub(super) const TERRAIN_UNITS_PER_TILE: u32 = 64;
pub(super) const TERRAIN_TILE_WIDTH: u32 = 64;
pub(super) const TERRAIN_TILE_HEIGHT: u32 = 64;
pub(super) const TERRAIN_MATERIALS: &[&str] = &[
    "grass",
    "field",
    "dirt",
    "stone",
    "water",
    "settlement",
    "cobble",
    "rock",
    "ruin",
    "shore",
];

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentManifest {
    pub schema_version: String,
    pub content_hash: String,
    pub object_count: usize,
}

#[derive(Debug, Clone)]
pub struct LoadedWorldContent {
    pub content: WorldContent,
    pub manifest: ContentManifest,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldContent {
    pub schema_version: String,
    pub map: MapContent,
    pub spawn: SpawnContent,
    pub objects: Vec<ObjectContent>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapContent {
    pub width: f32,
    pub height: f32,
    pub safe_zone_radius: f32,
    pub terrain: Option<TerrainContent>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainContent {
    pub profile: String,
    pub seed: u32,
    pub units_per_tile: u32,
    pub tile_width: u32,
    pub tile_height: u32,
    pub height_scale: f32,
    pub min_elevation: i32,
    pub max_elevation: i32,
    pub water_level: i32,
    pub max_walkable_step: u32,
    pub materials: Vec<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnContent {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectContent {
    pub id: String,
    pub kind: ObjectKind,
    pub label: String,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
}

impl WorldContent {
    #[cfg(test)]
    pub fn demo() -> Self {
        let raw = include_str!("../data/world.json");
        let content: Self = serde_json::from_str(raw).expect("embedded demo world is valid JSON");
        content.validate().expect("embedded demo world is valid");
        content
    }

    pub fn load_with_limits(
        path: impl AsRef<Path>,
        max_objects: usize,
    ) -> anyhow::Result<LoadedWorldContent> {
        let path = path.as_ref();
        let raw = fs::read_to_string(path)
            .with_context(|| format!("failed to read world content from {}", path.display()))?;
        let content: Self = serde_json::from_str(&raw)
            .with_context(|| format!("failed to parse world content from {}", path.display()))?;
        content.validate_with_limits(max_objects)?;
        let manifest = ContentManifest {
            schema_version: content.schema_version.clone(),
            content_hash: stable_content_hash(&raw),
            object_count: content.objects.len(),
        };
        Ok(LoadedWorldContent { content, manifest })
    }
}

impl TerrainContent {
    pub fn snapshot(&self) -> TerrainSnapshot {
        TerrainSnapshot {
            profile: self.profile.clone(),
            seed: self.seed,
            units_per_tile: self.units_per_tile,
            tile_width: self.tile_width,
            tile_height: self.tile_height,
            height_scale: self.height_scale,
            min_elevation: self.min_elevation,
            max_elevation: self.max_elevation,
            water_level: self.water_level,
            max_walkable_step: self.max_walkable_step,
            materials: self.materials.clone(),
        }
    }
}
