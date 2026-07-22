use crate::protocol::{PlayerId, RegionRoutingSnapshot};

pub(crate) const REGION_EDGE_MARGIN: f32 = 28.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegionExit {
    North,
    East,
    South,
    West,
}

impl RegionExit {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::North => "north",
            Self::East => "east",
            Self::South => "south",
            Self::West => "west",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RegionHandoffIntent {
    pub player_id: PlayerId,
    pub from_region: String,
    pub to_region: String,
    pub exit: RegionExit,
    pub global_x: f32,
    pub global_y: f32,
    pub destination_x: f32,
    pub destination_y: f32,
}

pub(crate) fn detect_region_handoff(
    region: Option<&RegionRoutingSnapshot>,
    player_id: PlayerId,
    width: f32,
    height: f32,
    units_per_tile: u32,
    intended_x: f32,
    intended_y: f32,
) -> Option<RegionHandoffIntent> {
    let region = region?;
    let mut selected: Option<(RegionExit, f32)> = None;
    for (exit, pressure) in [
        (RegionExit::West, (REGION_EDGE_MARGIN - intended_x) / width),
        (
            RegionExit::East,
            (intended_x - (width - REGION_EDGE_MARGIN)) / width,
        ),
        (
            RegionExit::North,
            (REGION_EDGE_MARGIN - intended_y) / height,
        ),
        (
            RegionExit::South,
            (intended_y - (height - REGION_EDGE_MARGIN)) / height,
        ),
    ] {
        if pressure > 0.0 && selected.map_or(true, |(_, prior)| pressure > prior) {
            selected = Some((exit, pressure));
        }
    }
    let (exit, _) = selected?;
    let to_region = match exit {
        RegionExit::North => region.neighbors.north.as_ref(),
        RegionExit::East => region.neighbors.east.as_ref(),
        RegionExit::South => region.neighbors.south.as_ref(),
        RegionExit::West => region.neighbors.west.as_ref(),
    }?;
    let clamped_x = intended_x.clamp(REGION_EDGE_MARGIN, width - REGION_EDGE_MARGIN);
    let clamped_y = intended_y.clamp(REGION_EDGE_MARGIN, height - REGION_EDGE_MARGIN);
    let (boundary_x, boundary_y, destination_x, destination_y) = match exit {
        RegionExit::North => (clamped_x, 0.0, clamped_x, height - REGION_EDGE_MARGIN),
        RegionExit::East => (width, clamped_y, REGION_EDGE_MARGIN, clamped_y),
        RegionExit::South => (clamped_x, height, clamped_x, REGION_EDGE_MARGIN),
        RegionExit::West => (0.0, clamped_y, width - REGION_EDGE_MARGIN, clamped_y),
    };
    let units = units_per_tile as f32;
    Some(RegionHandoffIntent {
        player_id,
        from_region: region.region_id.clone(),
        to_region: to_region.clone(),
        exit,
        global_x: region.tile_origin.x as f32 * units + boundary_x,
        global_y: region.tile_origin.y as f32 * units + boundary_y,
        destination_x,
        destination_y,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{RegionCoordSnapshot, RegionNeighborsSnapshot};

    #[test]
    fn routes_cardinal_exits_and_preserves_global_boundary_coordinates() {
        let region = fixture();
        let player = PlayerId::nil();
        let east = detect_region_handoff(
            Some(&region),
            player,
            12_288.0,
            8_192.0,
            64,
            12_270.0,
            4_100.0,
        )
        .expect("east pressure routes to east neighbor");
        assert_eq!(east.exit, RegionExit::East);
        assert_eq!(east.to_region, "duskfell-continent-r6-7");
        assert_eq!(east.global_x, 73_728.0);
        assert_eq!(east.global_y, 61_444.0);
        assert_eq!(east.destination_x, REGION_EDGE_MARGIN);
        assert_eq!(east.destination_y, 4_100.0);

        let north =
            detect_region_handoff(Some(&region), player, 12_288.0, 8_192.0, 64, 6_000.0, 20.0)
                .expect("north pressure routes to north neighbor");
        assert_eq!(north.to_region, "duskfell-continent-r5-6");
        assert_eq!(north.destination_y, 8_192.0 - REGION_EDGE_MARGIN);
    }

    #[test]
    fn refuses_missing_neighbors_and_chooses_larger_corner_pressure() {
        let mut region = fixture();
        region.neighbors.west = None;
        assert!(detect_region_handoff(
            Some(&region),
            PlayerId::nil(),
            100.0,
            100.0,
            64,
            20.0,
            50.0,
        )
        .is_none());
        let corner =
            detect_region_handoff(Some(&region), PlayerId::nil(), 100.0, 100.0, 64, 90.0, 80.0)
                .expect("corner pressure routes through one cardinal edge");
        assert_eq!(corner.exit, RegionExit::East);
    }

    fn fixture() -> RegionRoutingSnapshot {
        RegionRoutingSnapshot {
            schema_version: "duskfell-region-routing-v1".to_string(),
            atlas_id: "duskfell-continent".to_string(),
            atlas_content_sha256: "a".repeat(64),
            region_id: "duskfell-continent-r5-7".to_string(),
            coord: RegionCoordSnapshot { x: 5, y: 7 },
            tile_origin: RegionCoordSnapshot { x: 960, y: 896 },
            neighbors: RegionNeighborsSnapshot {
                north: Some("duskfell-continent-r5-6".to_string()),
                east: Some("duskfell-continent-r6-7".to_string()),
                south: Some("duskfell-continent-r5-8".to_string()),
                west: Some("duskfell-continent-r4-7".to_string()),
            },
        }
    }
}
