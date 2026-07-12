use std::fs;
use std::path::Path;

use anyhow::Context;
use serde::Deserialize;

use crate::protocol::{ObjectKind, TerrainSnapshot};

mod hash;
mod personas;
mod validation;

#[cfg(test)]
mod tests;

use self::hash::stable_content_hash;
pub use self::personas::{load_personas, PersonaContent};

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
    pub npc_count: usize,
    pub persona_count: usize,
    pub personas_hash: String,
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
    #[serde(default)]
    pub npcs: Vec<NpcContent>,
    /// One paragraph of world context for NPC cognition prompts (prefix-stable).
    #[serde(default)]
    pub lore: Option<String>,
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
    // baked from the client worldgen by scripts/generate-terrain-grid.js so
    // walkability matches what the player sees; row strings of base-36
    // indices into `materials`, plus a (rows+1)x(cols+1) vertex height grid
    #[serde(default)]
    pub material_grid: Vec<String>,
    #[serde(default)]
    pub vertex_heights: Vec<Vec<i32>>,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcContent {
    pub id: String,
    pub persona: String,
    pub name: String,
    pub x: f32,
    pub y: f32,
    #[serde(default = "default_npc_radius")]
    pub radius: f32,
    #[serde(default)]
    pub schedule: Vec<NpcScheduleContent>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcScheduleContent {
    pub at_seconds: u32,
    pub x: f32,
    pub y: f32,
}

fn default_npc_radius() -> f32 {
    20.0
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
            npc_count: content.npcs.len(),
            // Filled in after the persona directory loads (runtime.rs).
            persona_count: 0,
            personas_hash: String::new(),
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
