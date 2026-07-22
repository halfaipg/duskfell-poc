use crate::protocol::{RegionCoordSnapshot, RegionNeighborsSnapshot, RegionRoutingSnapshot};
use crate::region_routing::detect_region_handoff;

use super::*;

#[test]
fn player_state_round_trips_between_adjacent_regions_without_duplication() {
    let player_id = Uuid::new_v4();
    let mut source = SimWorld::new();
    source.map.region = Some(region_fixture(
        "duskfell-r0-0",
        RegionCoordSnapshot { x: 0, y: 0 },
        RegionCoordSnapshot { x: 0, y: 0 },
        RegionNeighborsSnapshot {
            north: None,
            east: Some("duskfell-r1-0".to_string()),
            south: None,
            west: None,
        },
    ));
    source
        .add_player_with_identity(
            player_id,
            Some("Roadwarden".to_string()),
            Some("acct:traveler-7".to_string()),
        )
        .expect("source player spawns");
    let entity = source.players[&player_id];
    {
        let mut player = source
            .world
            .get_mut::<Player>(entity)
            .expect("source player component exists");
        player.demo_deeds.push("deed-ancient-crossing".to_string());
        player
            .inventory
            .add_resource(ResourceKind::Wood, 17)
            .expect("wood added");
        player
            .inventory
            .add_item(InventoryItemKind::Crafted(CraftedItemKind::TrailKit), 2)
            .expect("trail kits added");
        player.inventory.stacks[0].age_years = 3;
        player.inventory.stacks[0].age_progress_years = 0.25;
    }

    let source_region = source.map.region.as_ref().expect("source has region");
    let intent = detect_region_handoff(
        Some(source_region),
        player_id,
        source.map.width,
        source.map.height,
        source.map.terrain_snapshot.units_per_tile,
        source.map.width - 10.0,
        500.0,
    )
    .expect("east edge creates handoff intent");
    let transfer = source
        .export_player_transfer(&intent)
        .expect("source exports bounded state");

    let mut destination = SimWorld::new();
    destination.map.region = Some(region_fixture(
        "duskfell-r1-0",
        RegionCoordSnapshot { x: 1, y: 0 },
        RegionCoordSnapshot { x: 192, y: 0 },
        RegionNeighborsSnapshot {
            north: None,
            east: None,
            south: None,
            west: Some("duskfell-r0-0".to_string()),
        },
    ));
    destination
        .admit_player_transfer(transfer.clone())
        .expect("destination admits signed-state candidate");

    let snapshot = destination.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("transferred player is present");
    assert_eq!(player.name, "Roadwarden");
    assert_eq!(player.account_subject.as_deref(), Some("acct:traveler-7"));
    assert_eq!(player.demo_deeds, vec!["deed-ancient-crossing"]);
    assert_eq!(player.resources.wood, 17);
    assert_eq!(
        player
            .inventory
            .items
            .iter()
            .find(|item| item.item_id == "trail-kit")
            .map(|item| item.quantity),
        Some(2)
    );
    assert_eq!(
        destination.admit_player_transfer(transfer),
        Err(TransferStateError::PlayerAlreadyPresent)
    );
}

#[test]
fn destination_rejects_wrong_atlas_and_unbounded_inventory() {
    let player_id = Uuid::new_v4();
    let mut source = SimWorld::new();
    source.map.region = Some(region_fixture(
        "duskfell-r0-0",
        RegionCoordSnapshot { x: 0, y: 0 },
        RegionCoordSnapshot { x: 0, y: 0 },
        RegionNeighborsSnapshot {
            north: None,
            east: Some("duskfell-r1-0".to_string()),
            south: None,
            west: None,
        },
    ));
    source.add_player(player_id);
    let intent = detect_region_handoff(
        source.map.region.as_ref(),
        player_id,
        source.map.width,
        source.map.height,
        source.map.terrain_snapshot.units_per_tile,
        source.map.width - 10.0,
        500.0,
    )
    .expect("handoff intent");
    let mut transfer = source
        .export_player_transfer(&intent)
        .expect("transfer exports");

    let mut destination = SimWorld::new();
    destination.map.region = Some(region_fixture(
        "duskfell-r1-0",
        RegionCoordSnapshot { x: 1, y: 0 },
        RegionCoordSnapshot { x: 192, y: 0 },
        RegionNeighborsSnapshot {
            north: None,
            east: None,
            south: None,
            west: Some("duskfell-r0-0".to_string()),
        },
    ));

    transfer.atlas_content_sha256 = "b".repeat(64);
    assert_eq!(
        destination.admit_player_transfer(transfer.clone()),
        Err(TransferStateError::WrongDestination)
    );
    transfer.atlas_content_sha256 = "a".repeat(64);
    transfer
        .inventory_stacks
        .push(PlayerTransferInventoryStack {
            item_id: "admin-sword".to_string(),
            quantity: u32::MAX,
            age_years: 0,
            age_progress_years: 0.0,
        });
    assert_eq!(
        destination.admit_player_transfer(transfer),
        Err(TransferStateError::InvalidInventory)
    );
}

fn region_fixture(
    region_id: &str,
    coord: RegionCoordSnapshot,
    tile_origin: RegionCoordSnapshot,
    neighbors: RegionNeighborsSnapshot,
) -> RegionRoutingSnapshot {
    RegionRoutingSnapshot {
        schema_version: "duskfell-region-routing-v1".to_string(),
        atlas_id: "duskfell".to_string(),
        atlas_content_sha256: "a".repeat(64),
        region_id: region_id.to_string(),
        coord,
        tile_origin,
        neighbors,
    }
}
