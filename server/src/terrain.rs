use crate::protocol::TerrainSnapshot;

#[derive(Debug, Clone)]
pub struct TerrainAuthority {
    profile: TerrainSnapshot,
    cols: u32,
    rows: u32,
    safe_radius_tiles: f32,
    baked: Option<BakedTerrainGrid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerrainMaterial {
    Grass,
    Field,
    Dirt,
    Stone,
    Water,
    Settlement,
    Cobble,
    Rock,
    Ruin,
    Shore,
}

impl TerrainMaterial {
    fn from_name(name: &str) -> Option<Self> {
        match name {
            "grass" => Some(Self::Grass),
            "field" => Some(Self::Field),
            "dirt" => Some(Self::Dirt),
            "stone" => Some(Self::Stone),
            "water" => Some(Self::Water),
            "settlement" => Some(Self::Settlement),
            "cobble" => Some(Self::Cobble),
            "rock" => Some(Self::Rock),
            "ruin" => Some(Self::Ruin),
            "shore" => Some(Self::Shore),
            _ => None,
        }
    }
}

// per-tile materials and per-vertex heights baked from the client worldgen
// (scripts/generate-terrain-grid.js) — the walkability authority must match
// the map the player actually sees, so baked data always wins over the
// legacy procedural fallback below
#[derive(Debug, Clone)]
pub struct BakedTerrainGrid {
    materials: Vec<Vec<TerrainMaterial>>,
    vertex_heights: Vec<Vec<i32>>,
}

impl BakedTerrainGrid {
    pub fn from_grids(
        material_grid: &[String],
        vertex_heights: &[Vec<i32>],
        legend: &[String],
        cols: u32,
        rows: u32,
    ) -> Result<Option<Self>, String> {
        if material_grid.is_empty() && vertex_heights.is_empty() {
            return Ok(None);
        }
        if material_grid.len() != rows as usize {
            return Err(format!(
                "materialGrid has {} rows, expected {rows}",
                material_grid.len()
            ));
        }
        if vertex_heights.len() != rows as usize + 1 {
            return Err(format!(
                "vertexHeights has {} rows, expected {}",
                vertex_heights.len(),
                rows + 1
            ));
        }
        let mut materials = Vec::with_capacity(rows as usize);
        for (y, row) in material_grid.iter().enumerate() {
            if row.chars().count() != cols as usize {
                return Err(format!(
                    "materialGrid row {y} has {} tiles, expected {cols}",
                    row.len()
                ));
            }
            let mut tile_row = Vec::with_capacity(cols as usize);
            for (x, ch) in row.chars().enumerate() {
                let index = ch
                    .to_digit(36)
                    .ok_or_else(|| format!("materialGrid[{y}][{x}] '{ch}' is not base-36"))?;
                let name = legend.get(index as usize).ok_or_else(|| {
                    format!("materialGrid[{y}][{x}] index {index} outside legend")
                })?;
                let material = TerrainMaterial::from_name(name)
                    .ok_or_else(|| format!("unknown terrain material '{name}'"))?;
                tile_row.push(material);
            }
            materials.push(tile_row);
        }
        for (y, row) in vertex_heights.iter().enumerate() {
            if row.len() != cols as usize + 1 {
                return Err(format!(
                    "vertexHeights row {y} has {} vertices, expected {}",
                    row.len(),
                    cols + 1
                ));
            }
        }
        Ok(Some(Self {
            materials,
            vertex_heights: vertex_heights.to_vec(),
        }))
    }
}

impl TerrainAuthority {
    pub fn new(
        profile: TerrainSnapshot,
        map_width: f32,
        map_height: f32,
        safe_zone_radius: f32,
    ) -> Self {
        Self::with_baked_grid(profile, map_width, map_height, safe_zone_radius, None)
    }

    pub fn with_baked_grid(
        profile: TerrainSnapshot,
        map_width: f32,
        map_height: f32,
        safe_zone_radius: f32,
        baked: Option<BakedTerrainGrid>,
    ) -> Self {
        let units_per_tile = profile.units_per_tile as f32;
        Self {
            profile,
            cols: (map_width / units_per_tile).ceil() as u32,
            rows: (map_height / units_per_tile).ceil() as u32,
            safe_radius_tiles: safe_zone_radius / units_per_tile,
            baked,
        }
    }

    pub fn material_at_world(&self, world_x: f32, world_y: f32) -> TerrainMaterial {
        let (tile_x, tile_y, _, _) = self.world_tile(world_x, world_y);
        self.material_for_tile(tile_x, tile_y)
    }

    pub fn height_at_world(&self, world_x: f32, world_y: f32) -> f32 {
        let (tile_x, tile_y, fx, fy) = self.world_tile(world_x, world_y);
        let heights = self.corner_heights(tile_x, tile_y);
        bilerp(heights.nw, heights.ne, heights.sw, heights.se, fx, fy)
    }

    pub fn is_walkable_at_world(&self, world_x: f32, world_y: f32) -> bool {
        // mountains are solid: rock is the massif body and never walkable,
        // like water — impassability comes from material, not step height,
        // so bilerped boundary tiles cannot form accidental ramps
        let material = self.material_at_world(world_x, world_y);
        material != TerrainMaterial::Water && material != TerrainMaterial::Rock
    }

    pub fn allows_step(&self, from_x: f32, from_y: f32, to_x: f32, to_y: f32) -> bool {
        if !self.is_walkable_at_world(to_x, to_y) {
            return false;
        }
        let from_height = self.height_at_world(from_x, from_y);
        let to_height = self.height_at_world(to_x, to_y);
        (to_height - from_height).abs() <= self.profile.max_walkable_step as f32
    }

    fn world_tile(&self, world_x: f32, world_y: f32) -> (u32, u32, f32, f32) {
        let units_per_tile = self.profile.units_per_tile as f32;
        let map_x =
            (world_x / units_per_tile).clamp(0.0, self.cols.saturating_sub(1) as f32 + 0.999);
        let map_y =
            (world_y / units_per_tile).clamp(0.0, self.rows.saturating_sub(1) as f32 + 0.999);
        let tile_x = map_x.floor().min(self.cols.saturating_sub(1) as f32) as u32;
        let tile_y = map_y.floor().min(self.rows.saturating_sub(1) as f32) as u32;
        (tile_x, tile_y, map_x - tile_x as f32, map_y - tile_y as f32)
    }

    fn material_for_tile(&self, x: u32, y: u32) -> TerrainMaterial {
        if let Some(baked) = &self.baked {
            return baked.materials[y as usize][x as usize];
        }
        let x_f = x as f32;
        let y_f = y as f32;
        let rows_f = self.rows as f32;
        let cols_f = self.cols as f32;
        let river_center = rows_f * 0.66 - (x_f / 3.2).sin() * 2.2 + (x_f / 5.4).cos() * 1.2;
        let river_distance = (y_f - river_center).abs();
        if river_distance < 0.9 {
            return TerrainMaterial::Water;
        }
        if river_distance < 1.75 {
            return TerrainMaterial::Dirt;
        }

        let center_distance =
            ((x_f + 0.5 - cols_f / 2.0).powi(2) + (y_f + 0.5 - rows_f / 2.0).powi(2)).sqrt();
        if center_distance < self.safe_radius_tiles * 0.72 {
            return TerrainMaterial::Settlement;
        }

        let grain = noise2d(x_f, y_f, self.profile.seed);
        let ridge = ((x_f + y_f) * 0.34).sin() + ((x_f - y_f) * 0.41).cos();
        if grain > 0.72 || ridge > 1.25 {
            TerrainMaterial::Stone
        } else if grain < -0.36 || river_distance < 2.4 {
            TerrainMaterial::Grass
        } else {
            TerrainMaterial::Field
        }
    }

    fn corner_heights(&self, x: u32, y: u32) -> TileHeights {
        if self.material_for_tile(x, y) == TerrainMaterial::Water {
            let water = self.profile.water_level as f32;
            return TileHeights {
                nw: water,
                ne: water,
                se: water,
                sw: water,
            };
        }

        let mut heights = TileHeights {
            nw: self.vertex_height(x, y),
            ne: self.vertex_height(x + 1, y),
            se: self.vertex_height(x + 1, y + 1),
            sw: self.vertex_height(x, y + 1),
        };

        if self.material_for_tile(x, y) == TerrainMaterial::Settlement {
            heights.nw = heights.nw.clamp(0.0, 1.0);
            heights.ne = heights.ne.clamp(0.0, 1.0);
            heights.se = heights.se.clamp(0.0, 1.0);
            heights.sw = heights.sw.clamp(0.0, 1.0);
        }

        heights
    }

    fn vertex_height(&self, x: u32, y: u32) -> f32 {
        if let Some(baked) = &self.baked {
            return baked.vertex_heights[y as usize][x as usize] as f32;
        }
        let x_f = x as f32;
        let y_f = y as f32;
        let center_distance = ((x_f - self.cols as f32 / 2.0).powi(2)
            + (y_f - self.rows as f32 / 2.0).powi(2))
        .sqrt();
        if center_distance < self.safe_radius_tiles * 0.58 {
            return 0.0;
        }

        let wave = (x_f * 0.47).sin() * 1.2 + (y_f * 0.39).cos() * 1.1 + ((x_f - y_f) * 0.24).sin();
        let ridged = noise2d(x_f * 0.7, y_f * 0.7, self.profile.seed) * 1.7;
        (wave + ridged).round().clamp(
            self.profile.min_elevation as f32,
            self.profile.max_elevation as f32,
        )
    }
}

#[derive(Debug, Clone, Copy)]
struct TileHeights {
    nw: f32,
    ne: f32,
    se: f32,
    sw: f32,
}

fn bilerp(nw: f32, ne: f32, sw: f32, se: f32, fx: f32, fy: f32) -> f32 {
    let north = nw * (1.0 - fx) + ne * fx;
    let south = sw * (1.0 - fx) + se * fx;
    north * (1.0 - fy) + south * fy
}

fn noise2d(x: f32, y: f32, seed: u32) -> f32 {
    hash_unit(
        (x * 17.0).floor() as u32,
        (y * 17.0).floor() as u32,
        seed + 3,
    )
}

fn hash_unit(x: u32, y: u32, seed: u32) -> f32 {
    let mut value = x.wrapping_add(101).wrapping_mul(374_761_393)
        ^ y.wrapping_add(181).wrapping_mul(668_265_263)
        ^ seed.wrapping_add(31).wrapping_mul(2_147_483_647);
    value = (value ^ (value >> 13)).wrapping_mul(1_274_126_177);
    let normalized = (value ^ (value >> 16)) as f64 / 0xffff_ffffu32 as f64;
    (normalized * 2.0 - 1.0) as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn water_is_not_walkable() {
        let terrain = demo_terrain();
        let (x, y) = find_material(&terrain, TerrainMaterial::Water);

        assert!(!terrain.is_walkable_at_world(x, y));
    }

    #[test]
    fn settlement_spawn_is_walkable_and_flat_enough() {
        let terrain = demo_terrain();

        assert_eq!(
            terrain.material_at_world(1216.0, 832.0),
            TerrainMaterial::Settlement
        );
        assert!(terrain.is_walkable_at_world(1216.0, 832.0));
        assert!(terrain.allows_step(1216.0, 832.0, 1280.0, 800.0));
    }

    #[test]
    fn steep_steps_are_rejected_by_profile_limit() {
        let terrain = demo_terrain();
        let mut rejected = false;

        for y in (0..1664).step_by(32) {
            for x in (0..2560).step_by(32) {
                let from_x = x as f32;
                let from_y = y as f32;
                let to_x = (x + 64).min(2559) as f32;
                let to_y = y as f32;
                if terrain.is_walkable_at_world(from_x, from_y)
                    && terrain.is_walkable_at_world(to_x, to_y)
                    && (terrain.height_at_world(from_x, from_y)
                        - terrain.height_at_world(to_x, to_y))
                    .abs()
                        > terrain.profile.max_walkable_step as f32
                {
                    rejected = !terrain.allows_step(from_x, from_y, to_x, to_y);
                    break;
                }
            }
            if rejected {
                break;
            }
        }

        assert!(
            rejected,
            "expected at least one steep terrain step to be rejected"
        );
    }

    fn demo_terrain() -> TerrainAuthority {
        TerrainAuthority::new(
            TerrainSnapshot {
                profile: "duskfell-terrain-v1".to_string(),
                seed: 7341,
                units_per_tile: 64,
                tile_width: 64,
                tile_height: 64,
                height_scale: 6.0,
                min_elevation: -1,
                max_elevation: 4,
                water_level: -1,
                max_walkable_step: 1,
                materials: vec![
                    "grass".to_string(),
                    "field".to_string(),
                    "dirt".to_string(),
                    "stone".to_string(),
                    "water".to_string(),
                    "settlement".to_string(),
                ],
            },
            2560.0,
            1664.0,
            320.0,
        )
    }

    fn find_material(terrain: &TerrainAuthority, material: TerrainMaterial) -> (f32, f32) {
        for y in (0..1664).step_by(16) {
            for x in (0..2560).step_by(16) {
                let x = x as f32;
                let y = y as f32;
                if terrain.material_at_world(x, y) == material {
                    return (x, y);
                }
            }
        }
        panic!("material {material:?} not found in demo terrain");
    }
}
