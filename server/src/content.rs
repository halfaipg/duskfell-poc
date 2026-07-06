use std::collections::HashSet;
use std::fs;
use std::path::Path;

use anyhow::{anyhow, Context};
use serde::Deserialize;

use crate::protocol::{ObjectKind, TerrainSnapshot};

pub const WORLD_SCHEMA_VERSION: &str = "sundermere-world-v1";
pub const TERRAIN_PROFILE: &str = "duskfell-terrain-v1";
const TERRAIN_UNITS_PER_TILE: u32 = 64;
const TERRAIN_TILE_WIDTH: u32 = 64;
const TERRAIN_TILE_HEIGHT: u32 = 64;
const TERRAIN_MATERIALS: &[&str] = &["grass", "field", "dirt", "stone", "water", "settlement"];

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

    #[cfg(test)]
    pub fn validate(&self) -> anyhow::Result<()> {
        self.validate_with_limits(usize::MAX)
    }

    pub fn validate_with_limits(&self, max_objects: usize) -> anyhow::Result<()> {
        if self.schema_version != WORLD_SCHEMA_VERSION {
            return Err(anyhow!(
                "world content schemaVersion '{}' is not supported; expected '{}'",
                self.schema_version,
                WORLD_SCHEMA_VERSION
            ));
        }

        validate_positive("map.width", self.map.width)?;
        validate_positive("map.height", self.map.height)?;
        validate_positive("map.safe_zone_radius", self.map.safe_zone_radius)?;
        if self.map.safe_zone_radius > self.map.width.min(self.map.height) / 2.0 {
            return Err(anyhow!("map.safeZoneRadius must fit inside map bounds"));
        }
        let terrain =
            self.map.terrain.as_ref().ok_or_else(|| {
                anyhow!("map.terrain must be declared for supported world content")
            })?;
        validate_terrain(terrain)?;

        if self.objects.len() > max_objects {
            return Err(anyhow!(
                "world content object count {} exceeds MAX_CONTENT_OBJECTS {}",
                self.objects.len(),
                max_objects
            ));
        }

        if self.spawn.x < 0.0
            || self.spawn.x > self.map.width
            || self.spawn.y < 0.0
            || self.spawn.y > self.map.height
        {
            return Err(anyhow!("spawn must be inside map bounds"));
        }

        let mut ids = HashSet::new();
        for object in &self.objects {
            if object.id.is_empty()
                || !object
                    .id
                    .chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
            {
                return Err(anyhow!(
                    "object id '{}' must be lowercase ascii kebab-case",
                    object.id
                ));
            }
            if !ids.insert(object.id.as_str()) {
                return Err(anyhow!("duplicate object id '{}'", object.id));
            }
            if object.label.trim().is_empty() || object.label.len() > 40 {
                return Err(anyhow!(
                    "object '{}' label must be 1-40 characters",
                    object.id
                ));
            }
            validate_positive("object.radius", object.radius)?;
            if object.x < 0.0
                || object.x > self.map.width
                || object.y < 0.0
                || object.y > self.map.height
            {
                return Err(anyhow!("object '{}' must be inside map bounds", object.id));
            }
            if object.x - object.radius < 0.0
                || object.x + object.radius > self.map.width
                || object.y - object.radius < 0.0
                || object.y + object.radius > self.map.height
            {
                return Err(anyhow!(
                    "object '{}' footprint radius must fit inside map bounds",
                    object.id
                ));
            }
        }

        self.require_object_kind("registrar", ObjectKind::Registrar)?;
        self.require_object_kind("field-forge", ObjectKind::Forge)?;

        Ok(())
    }

    fn require_object_kind(&self, id: &str, expected_kind: ObjectKind) -> anyhow::Result<()> {
        let Some(object) = self.objects.iter().find(|object| object.id == id) else {
            return Err(anyhow!("world content must include object id '{}'", id));
        };
        if object.kind != expected_kind {
            let expected = serde_json::to_string(&expected_kind)
                .unwrap_or_else(|_| format!("{expected_kind:?}"))
                .trim_matches('"')
                .to_string();
            return Err(anyhow!(
                "world content object id '{}' must have kind '{}'",
                id,
                expected
            ));
        }
        Ok(())
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

fn stable_content_hash(raw: &str) -> String {
    // FNV-1a: stable, tiny, and enough for an ops fingerprint. Not a security hash.
    let mut hash = 0xcbf29ce484222325u64;
    for byte in raw.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64:{hash:016x}")
}

fn validate_positive(field: &str, value: f32) -> anyhow::Result<()> {
    if !value.is_finite() || value <= 0.0 {
        return Err(anyhow!("{field} must be a positive finite number"));
    }
    Ok(())
}

fn validate_terrain(terrain: &TerrainContent) -> anyhow::Result<()> {
    if terrain.profile != TERRAIN_PROFILE {
        return Err(anyhow!(
            "map.terrain.profile '{}' is not supported; expected '{}'",
            terrain.profile,
            TERRAIN_PROFILE
        ));
    }
    if terrain.units_per_tile != TERRAIN_UNITS_PER_TILE {
        return Err(anyhow!(
            "map.terrain.unitsPerTile must be {}",
            TERRAIN_UNITS_PER_TILE
        ));
    }
    if terrain.tile_width != TERRAIN_TILE_WIDTH || terrain.tile_height != TERRAIN_TILE_HEIGHT {
        return Err(anyhow!(
            "map.terrain tile dimensions must be {}x{} 1:1 military projection tiles",
            TERRAIN_TILE_WIDTH,
            TERRAIN_TILE_HEIGHT
        ));
    }
    validate_positive("map.terrain.heightScale", terrain.height_scale)?;
    if terrain.min_elevation > terrain.max_elevation {
        return Err(anyhow!(
            "map.terrain.minElevation must be less than or equal to maxElevation"
        ));
    }
    if terrain.water_level < terrain.min_elevation || terrain.water_level > terrain.max_elevation {
        return Err(anyhow!(
            "map.terrain.waterLevel must be inside the elevation range"
        ));
    }
    if terrain.max_walkable_step == 0 {
        return Err(anyhow!("map.terrain.maxWalkableStep must be positive"));
    }
    if terrain.max_walkable_step as i32 > terrain.max_elevation - terrain.min_elevation {
        return Err(anyhow!(
            "map.terrain.maxWalkableStep must fit inside the elevation range"
        ));
    }
    let mut unique_materials = HashSet::new();
    for material in &terrain.materials {
        if !unique_materials.insert(material.as_str()) {
            return Err(anyhow!(
                "map.terrain.materials contains duplicate material '{}'",
                material
            ));
        }
        if !TERRAIN_MATERIALS.contains(&material.as_str()) {
            return Err(anyhow!(
                "map.terrain.materials contains unsupported material '{}'",
                material
            ));
        }
    }
    if terrain.materials.len() != TERRAIN_MATERIALS.len() {
        return Err(anyhow!(
            "map.terrain.materials must declare the canonical Duskfell material set"
        ));
    }
    for expected in TERRAIN_MATERIALS {
        if !terrain
            .materials
            .iter()
            .any(|material| material == expected)
        {
            return Err(anyhow!("map.terrain.materials must include '{}'", expected));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_duplicate_object_ids() {
        let mut content = valid_minimal_content();
        content.objects.push(ObjectContent {
            id: "registrar".to_string(),
            kind: ObjectKind::Grove,
            label: "Other".to_string(),
            x: 20.0,
            y: 20.0,
            radius: 5.0,
        });

        assert!(content.validate().is_err());
    }

    #[test]
    fn rejects_missing_required_registrar() {
        let mut content = valid_minimal_content();
        content.objects.retain(|object| object.id != "registrar");

        let err = content
            .validate()
            .expect_err("registrar object is required");

        assert!(err.to_string().contains("object id 'registrar'"));
    }

    #[test]
    fn rejects_registrar_id_with_wrong_kind() {
        let mut content = valid_minimal_content();
        content.objects[0].kind = ObjectKind::Grove;

        let err = content
            .validate()
            .expect_err("registrar object must use registrar kind");

        assert!(err.to_string().contains("kind 'registrar'"));
    }

    #[test]
    fn rejects_missing_required_forge() {
        let mut content = valid_minimal_content();
        content.objects.retain(|object| object.id != "field-forge");

        let err = content
            .validate()
            .expect_err("field forge object is required");

        assert!(err.to_string().contains("object id 'field-forge'"));
    }

    #[test]
    fn rejects_forge_id_with_wrong_kind() {
        let mut content = valid_minimal_content();
        let forge = content
            .objects
            .iter_mut()
            .find(|object| object.id == "field-forge")
            .expect("valid fixture has forge");
        forge.kind = ObjectKind::Ore;

        let err = content
            .validate()
            .expect_err("field forge object must use forge kind");

        assert!(err.to_string().contains("kind 'forge'"));
    }

    #[test]
    fn rejects_safe_zone_larger_than_map_bounds() {
        let mut content = valid_minimal_content();
        content.map.safe_zone_radius = 60.0;

        let err = content
            .validate()
            .expect_err("safe zone must fit inside map bounds");

        assert!(err.to_string().contains("safeZoneRadius"));
    }

    #[test]
    fn rejects_missing_terrain_profile() {
        let mut content = valid_minimal_content();
        content.map.terrain = None;

        let err = content.validate().expect_err("terrain profile is required");

        assert!(err.to_string().contains("map.terrain"));
    }

    #[test]
    fn rejects_terrain_projection_drift() {
        let mut content = valid_minimal_content();
        content
            .map
            .terrain
            .as_mut()
            .expect("fixture has terrain")
            .tile_height = 32;

        let err = content
            .validate()
            .expect_err("terrain tile dimensions must stay in projection contract");

        assert!(err.to_string().contains("tile dimensions"));
    }

    #[test]
    fn rejects_unsupported_terrain_material() {
        let mut content = valid_minimal_content();
        content
            .map
            .terrain
            .as_mut()
            .expect("fixture has terrain")
            .materials[0] = "lava".to_string();

        let err = content
            .validate()
            .expect_err("terrain materials are canonical");

        assert!(err.to_string().contains("unsupported material"));
    }

    #[test]
    fn rejects_object_footprint_outside_map_bounds() {
        let mut content = valid_minimal_content();
        content.objects[0].x = 3.0;
        content.objects[0].radius = 5.0;

        let err = content
            .validate()
            .expect_err("object footprint must fit inside map bounds");

        assert!(err.to_string().contains("footprint radius"));
    }

    #[test]
    fn rejects_wrong_schema_version() {
        let mut content = WorldContent::demo();
        content.schema_version = "other-version".to_string();

        assert!(content.validate().is_err());
    }

    #[test]
    fn rejects_too_many_objects() {
        let content = WorldContent::demo();

        let err = content
            .validate_with_limits(1)
            .expect_err("object cap should reject demo content");

        assert!(err.to_string().contains("MAX_CONTENT_OBJECTS"));
    }

    #[test]
    fn stable_hash_is_deterministic() {
        assert_eq!(stable_content_hash("abc"), stable_content_hash("abc"));
        assert_ne!(stable_content_hash("abc"), stable_content_hash("abcd"));
        assert!(stable_content_hash("abc").starts_with("fnv1a64:"));
    }

    fn valid_minimal_content() -> WorldContent {
        WorldContent {
            schema_version: WORLD_SCHEMA_VERSION.to_string(),
            map: MapContent {
                width: 100.0,
                height: 100.0,
                safe_zone_radius: 20.0,
                terrain: Some(valid_terrain()),
            },
            spawn: SpawnContent { x: 20.0, y: 20.0 },
            objects: vec![
                ObjectContent {
                    id: "registrar".to_string(),
                    kind: ObjectKind::Registrar,
                    label: "Title Office".to_string(),
                    x: 10.0,
                    y: 10.0,
                    radius: 5.0,
                },
                ObjectContent {
                    id: "field-forge".to_string(),
                    kind: ObjectKind::Forge,
                    label: "Field Forge".to_string(),
                    x: 30.0,
                    y: 30.0,
                    radius: 5.0,
                },
            ],
        }
    }

    fn valid_terrain() -> TerrainContent {
        TerrainContent {
            profile: TERRAIN_PROFILE.to_string(),
            seed: 7341,
            units_per_tile: TERRAIN_UNITS_PER_TILE,
            tile_width: TERRAIN_TILE_WIDTH,
            tile_height: TERRAIN_TILE_HEIGHT,
            height_scale: 6.0,
            min_elevation: -1,
            max_elevation: 4,
            water_level: -1,
            max_walkable_step: 1,
            materials: TERRAIN_MATERIALS
                .iter()
                .map(|material| material.to_string())
                .collect(),
        }
    }
}
