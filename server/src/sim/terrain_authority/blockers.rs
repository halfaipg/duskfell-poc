use crate::protocol::TerrainSnapshot;

use super::super::movement::MovementBlocker;
use super::super::Position;
use super::validation::validate_terrain_detail_authority_header;
use super::TerrainDetailAuthority;

pub(in crate::sim) fn terrain_detail_authority_blockers(
    authority: Option<&TerrainDetailAuthority>,
    terrain_snapshot: &TerrainSnapshot,
) -> Result<Vec<MovementBlocker>, String> {
    let Some(authority) = authority else {
        return Ok(Vec::new());
    };
    validate_terrain_detail_authority_header(authority, terrain_snapshot)?;

    let units_per_tile = authority.units_per_tile as f32;
    authority
        .blockers
        .iter()
        .filter(|blocker| blocker.collision.blocks_movement)
        .map(|blocker| {
            if blocker.collision.shape != "aabb" {
                return Err(format!(
                    "terrain detail blocker {} uses unsupported collision shape {}",
                    blocker.id, blocker.collision.shape
                ));
            }
            if !blocker.x.is_finite()
                || !blocker.y.is_finite()
                || !blocker.collision.width_tiles.is_finite()
                || !blocker.collision.height_tiles.is_finite()
                || blocker.collision.width_tiles <= 0.0
                || blocker.collision.height_tiles <= 0.0
            {
                return Err(format!(
                    "terrain detail blocker {} has invalid collision geometry",
                    blocker.id
                ));
            }
            Ok(MovementBlocker::Aabb {
                position: Position {
                    x: blocker.x,
                    y: blocker.y,
                },
                half_width: blocker.collision.width_tiles * units_per_tile / 2.0,
                half_height: blocker.collision.height_tiles * units_per_tile / 2.0,
            })
        })
        .collect()
}
