use std::fs;
use std::path::Path;

use anyhow::Context;
use serde::Deserialize;

use crate::protocol::{ObjectKind, TerrainSnapshot, TrailPointSnapshot, TrailSnapshot};

mod hash;
mod validation;

#[cfg(test)]
mod tests;

use self::hash::stable_content_hash;

pub const WORLD_SCHEMA_VERSION: &str = "sundermere-world-v1";
pub const TERRAIN_PROFILE: &str = "duskfell-terrain-v1";
pub const MAX_NPCS: usize = 128;
pub const MAX_TRAILS: usize = 16;
pub const MAX_TRAIL_POINTS: usize = 64;
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
    #[serde(default)]
    pub npcs: Vec<NpcContent>,
    pub objects: Vec<ObjectContent>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NpcContent {
    pub id: String,
    pub name: String,
    pub role: String,
    pub persona: String,
    #[serde(default)]
    pub drives: Vec<String>,
    pub canned: Vec<String>,
    pub x: f32,
    pub y: f32,
    pub radius: f32,
    pub color: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapContent {
    pub width: f32,
    pub height: f32,
    pub safe_zone_radius: f32,
    #[serde(default)]
    pub region: Option<RegionRoutingContent>,
    pub terrain: Option<TerrainContent>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionRoutingContent {
    pub schema_version: String,
    pub atlas_id: String,
    pub atlas_content_sha256: String,
    pub region_id: String,
    pub coord: RegionCoordContent,
    pub tile_origin: RegionCoordContent,
    pub neighbors: RegionNeighborsContent,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegionCoordContent {
    pub x: u32,
    pub y: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegionNeighborsContent {
    pub north: Option<String>,
    pub east: Option<String>,
    pub south: Option<String>,
    pub west: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainContent {
    pub profile: String,
    pub seed: u32,
    #[serde(default)]
    pub detail_authority_enabled: Option<bool>,
    #[serde(default)]
    pub visual_detail_enabled: Option<bool>,
    pub units_per_tile: u32,
    pub tile_width: u32,
    pub tile_height: u32,
    pub height_scale: f32,
    pub min_elevation: i32,
    pub max_elevation: i32,
    pub water_level: i32,
    pub max_walkable_step: u32,
    #[serde(default = "default_vertex_height_precision")]
    pub vertex_height_precision: u32,
    pub materials: Vec<String>,
    // baked from the client worldgen by scripts/generate-terrain-grid.js so
    // walkability matches what the player sees; row strings of base-36
    // indices into `materials`, plus a (rows+1)x(cols+1) vertex height grid
    #[serde(default)]
    pub material_grid: Vec<String>,
    #[serde(default)]
    pub vertex_heights: Vec<Vec<i32>>,
    #[serde(default)]
    pub chunk_authority: Option<ChunkAuthorityContent>,
    #[serde(default)]
    pub trails: Vec<TrailContent>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChunkAuthorityContent {
    pub schema_version: String,
    pub index_sha256: String,
    pub chunk_count: u32,
    pub chunk_tiles: u32,
    pub apron_tiles: u32,
    pub vertex_height_precision: u32,
    pub total_bytes: u64,
}

fn default_vertex_height_precision() -> u32 {
    1
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrailContent {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub width_tiles: f32,
    pub points: Vec<TrailPointContent>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrailPointContent {
    pub x: f32,
    pub y: f32,
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
            detail_authority_enabled: self.detail_authority_enabled.unwrap_or(true),
            visual_detail_enabled: self.visual_detail_enabled.unwrap_or(true),
            units_per_tile: self.units_per_tile,
            tile_width: self.tile_width,
            tile_height: self.tile_height,
            height_scale: self.height_scale,
            min_elevation: self.min_elevation,
            max_elevation: self.max_elevation,
            water_level: self.water_level,
            max_walkable_step: self.max_walkable_step,
            vertex_height_precision: self.vertex_height_precision,
            materials: self.materials.clone(),
            trails: self
                .trails
                .iter()
                .map(|trail| TrailSnapshot {
                    id: trail.id.clone(),
                    label: trail.label.clone(),
                    kind: trail.kind.clone(),
                    width_tiles: trail.width_tiles,
                    points: trail
                        .points
                        .iter()
                        .map(|point| TrailPointSnapshot {
                            x: point.x,
                            y: point.y,
                        })
                        .collect(),
                })
                .collect(),
        }
    }
}
