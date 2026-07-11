use std::collections::HashSet;

use anyhow::anyhow;

use crate::protocol::ObjectKind;

use super::{
    TerrainContent, WorldContent, TERRAIN_MATERIALS, TERRAIN_PROFILE, TERRAIN_TILE_HEIGHT,
    TERRAIN_TILE_WIDTH, TERRAIN_UNITS_PER_TILE, WORLD_SCHEMA_VERSION,
};

impl WorldContent {
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

        let mut npc_ids = HashSet::new();
        for npc in &self.npcs {
            if npc.id.is_empty()
                || !npc
                    .id
                    .chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
            {
                return Err(anyhow!(
                    "npc id '{}' must be lowercase ascii kebab-case",
                    npc.id
                ));
            }
            if !npc_ids.insert(npc.id.as_str()) {
                return Err(anyhow!("duplicate npc id '{}'", npc.id));
            }
            if npc.persona.is_empty()
                || !npc
                    .persona
                    .chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
            {
                return Err(anyhow!(
                    "npc '{}' persona '{}' must be lowercase ascii kebab-case",
                    npc.id,
                    npc.persona
                ));
            }
            if npc.name.trim().is_empty() || npc.name.len() > 40 {
                return Err(anyhow!("npc '{}' name must be 1-40 characters", npc.id));
            }
            validate_positive("npc.radius", npc.radius)?;
            if npc.x < 0.0 || npc.x > self.map.width || npc.y < 0.0 || npc.y > self.map.height {
                return Err(anyhow!("npc '{}' must be inside map bounds", npc.id));
            }
            for (index, entry) in npc.schedule.iter().enumerate() {
                if entry.x < 0.0
                    || entry.x > self.map.width
                    || entry.y < 0.0
                    || entry.y > self.map.height
                {
                    return Err(anyhow!(
                        "npc '{}' schedule entry {} destination must be inside map bounds",
                        npc.id,
                        index
                    ));
                }
            }
        }

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
