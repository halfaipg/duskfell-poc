use crate::protocol::TerrainSnapshot;

use super::TerrainDetailAuthority;

pub(in crate::sim::terrain_authority) fn validate_terrain_detail_authority_header(
    authority: &TerrainDetailAuthority,
    terrain_snapshot: &TerrainSnapshot,
) -> Result<(), String> {
    if authority.schema_version != "duskfell-terrain-detail-authority-v1" {
        return Err("terrain detail authority schemaVersion is unsupported".to_string());
    }
    if authority.projection != "military-plan-oblique" {
        return Err("terrain detail authority projection is unsupported".to_string());
    }
    if authority.profile != terrain_snapshot.profile {
        return Err(format!(
            "terrain detail authority profile {} does not match terrain profile {}",
            authority.profile, terrain_snapshot.profile
        ));
    }
    if authority.units_per_tile != terrain_snapshot.units_per_tile {
        return Err(format!(
            "terrain detail authority unitsPerTile {} does not match terrain unitsPerTile {}",
            authority.units_per_tile, terrain_snapshot.units_per_tile
        ));
    }
    Ok(())
}
