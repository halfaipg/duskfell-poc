use super::*;
use uuid::Uuid;

#[test]
fn terrain_detail_authority_resource_nodes_are_server_owned() {
    let player_id = Uuid::new_v4();
    let authority =
        test_terrain_detail_authority_with_resources(vec![test_terrain_detail_resource_node(
            "test-mycelium",
            ResourceKind::Mycelium,
            3,
            4,
            760.0,
            550.0,
        )]);
    let mut sim =
        SimWorld::from_content_with_terrain_detail_authority(WorldContent::demo(), Some(authority))
            .expect("test terrain detail authority should load");
    sim.add_player(player_id);
    move_player_to_object(
        &mut sim,
        player_id,
        "terrain-detail:test-mycelium",
        8.0,
        0.0,
    );

    let snapshot = sim.snapshot(empty_settlement());
    let mycelium = snapshot
        .objects
        .iter()
        .find(|object| object.id == "terrain-detail:test-mycelium")
        .expect("terrain detail mycelium should be in the authoritative snapshot");
    assert_eq!(mycelium.kind, ObjectKind::MyceliumPatch);
    assert_eq!(mycelium.resources[0].kind, ResourceKind::Mycelium);
    assert_eq!(mycelium.resources[0].amount, 3);

    sim.set_input(
        player_id,
        PlayerInput {
            interact: true,
            ..PlayerInput::default()
        },
    );
    let outcome = sim.tick(0.05);

    assert_eq!(outcome.resource_events.len(), 1);
    assert_eq!(
        outcome.resource_events[0].object_id,
        "terrain-detail:test-mycelium"
    );
    assert_eq!(outcome.resource_events[0].resource, ResourceKind::Mycelium);
    assert_node_event(
        &outcome.resource_node_events,
        "terrain-detail:test-mycelium",
        ResourceKind::Mycelium,
        2,
    );

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert_eq!(player.resources.mycelium, 1);
}

#[test]
fn terrain_detail_deadwood_decays_into_terrain_detail_mycelium() {
    let authority = test_terrain_detail_authority_with_resources(vec![
        test_terrain_detail_resource_node(
            "test-deadwood",
            ResourceKind::Deadwood,
            2,
            4,
            760.0,
            550.0,
        ),
        test_terrain_detail_resource_node(
            "test-mycelium",
            ResourceKind::Mycelium,
            1,
            4,
            800.0,
            550.0,
        ),
    ]);
    let mut sim =
        SimWorld::from_content_with_terrain_detail_authority(WorldContent::demo(), Some(authority))
            .expect("test terrain detail authority should load");

    let mut last_outcome = SimTickOutcome::default();
    for _ in 0..ECOLOGY_DECAY_FEED_INTERVAL_TICKS {
        last_outcome = sim.tick(0.05);
    }

    assert_node_event(
        &last_outcome.resource_node_events,
        "terrain-detail:test-deadwood",
        ResourceKind::Deadwood,
        1,
    );
    assert_node_event(
        &last_outcome.resource_node_events,
        "terrain-detail:test-mycelium",
        ResourceKind::Mycelium,
        2,
    );
}

#[test]
fn terrain_detail_decay_consumers_follow_authored_resource_recipes() {
    let authority = test_terrain_detail_authority_with_resources_and_decay_consumers(
        vec![
            test_terrain_detail_resource_node(
                "test-deadwood",
                ResourceKind::Deadwood,
                2,
                4,
                760.0,
                550.0,
            ),
            test_terrain_detail_resource_node(
                "test-mycelium",
                ResourceKind::Mycelium,
                1,
                4,
                800.0,
                550.0,
            ),
        ],
        vec![test_terrain_detail_decay_consumer(
            "test-mycelium",
            ResourceKind::Spores,
            1,
            800.0,
            550.0,
        )],
    );
    let mut sim =
        SimWorld::from_content_with_terrain_detail_authority(WorldContent::demo(), Some(authority))
            .expect("test terrain detail authority should load");

    let mut last_outcome = SimTickOutcome::default();
    for _ in 0..ECOLOGY_DECAY_FEED_INTERVAL_TICKS {
        last_outcome = sim.tick(0.05);
    }

    assert!(!last_outcome
        .resource_node_events
        .iter()
        .any(|event| event.object_id == "terrain-detail:test-deadwood"));
    assert!(!last_outcome
        .resource_node_events
        .iter()
        .any(|event| event.object_id == "terrain-detail:test-mycelium"));
}

#[test]
fn terrain_detail_decay_consumers_must_map_to_server_owned_objects() {
    let authority = test_terrain_detail_authority_with_resources_and_decay_consumers(
        vec![test_terrain_detail_resource_node(
            "test-deadwood",
            ResourceKind::Deadwood,
            2,
            4,
            760.0,
            550.0,
        )],
        vec![test_terrain_detail_decay_consumer(
            "missing-mycelium",
            ResourceKind::Deadwood,
            1,
            800.0,
            550.0,
        )],
    );
    let err =
        SimWorld::from_content_with_terrain_detail_authority(WorldContent::demo(), Some(authority))
            .expect_err("decay consumer without server object should fail startup");

    assert!(err.contains("does not map to a server-owned object"));
}

#[test]
fn off_map_terrain_detail_resource_nodes_are_not_promoted() {
    let authority = test_terrain_detail_authority_with_resources(vec![
        test_terrain_detail_resource_node(
            "off-map-deadwood",
            ResourceKind::Deadwood,
            2,
            4,
            WorldContent::demo().map.width + 24.0,
            550.0,
        ),
        test_terrain_detail_resource_node(
            "on-map-mycelium",
            ResourceKind::Mycelium,
            1,
            4,
            800.0,
            550.0,
        ),
    ]);
    let mut sim =
        SimWorld::from_content_with_terrain_detail_authority(WorldContent::demo(), Some(authority))
            .expect("off-map terrain detail resource should be skipped, not fatal");

    let snapshot = sim.snapshot(empty_settlement());
    assert!(!snapshot
        .objects
        .iter()
        .any(|object| object.id == "terrain-detail:off-map-deadwood"));
    assert!(snapshot
        .objects
        .iter()
        .any(|object| object.id == "terrain-detail:on-map-mycelium"));
}

fn test_terrain_detail_authority_with_resources(
    resource_nodes: Vec<TerrainDetailAuthorityResourceNode>,
) -> TerrainDetailAuthority {
    test_terrain_detail_authority_with_resources_and_decay_consumers(resource_nodes, Vec::new())
}

fn test_terrain_detail_authority_with_resources_and_decay_consumers(
    resource_nodes: Vec<TerrainDetailAuthorityResourceNode>,
    decay_consumers: Vec<TerrainDetailAuthorityDecayConsumer>,
) -> TerrainDetailAuthority {
    TerrainDetailAuthority {
        schema_version: "duskfell-terrain-detail-authority-v1".to_string(),
        projection: "military-plan-oblique".to_string(),
        profile: "duskfell-terrain-v1".to_string(),
        units_per_tile: 64,
        blockers: Vec::new(),
        resource_nodes,
        decay_consumers,
    }
}

fn test_terrain_detail_resource_node(
    id: &str,
    resource: ResourceKind,
    amount: u32,
    max_amount: u32,
    x: f32,
    y: f32,
) -> TerrainDetailAuthorityResourceNode {
    TerrainDetailAuthorityResourceNode {
        id: id.to_string(),
        resource_node_id: format!("terrain-detail:{id}"),
        kind: match resource {
            ResourceKind::Deadwood => "fallen-log",
            ResourceKind::Mycelium => "mushroom",
            ResourceKind::Stone => "ruin",
            ResourceKind::Ore => "boulder",
            ResourceKind::Wood | ResourceKind::Seed => "tree",
            ResourceKind::Fiber => "reeds",
            ResourceKind::Charge => "field-coil",
            ResourceKind::Spores => "stump",
        }
        .to_string(),
        x,
        y,
        resources: vec![TerrainDetailAuthorityResource {
            kind: resource,
            amount,
            max_amount,
        }],
        lifecycle: Some(TerrainDetailAuthorityLifecycle {
            family: Some(
                match resource {
                    ResourceKind::Deadwood | ResourceKind::Spores => "deadwood",
                    ResourceKind::Mycelium => "mycelium",
                    ResourceKind::Stone | ResourceKind::Ore => "mineral",
                    ResourceKind::Charge => "machine",
                    ResourceKind::Wood | ResourceKind::Seed | ResourceKind::Fiber => "tree",
                }
                .to_string(),
            ),
            stage: None,
            species: None,
            age_years: Some(1),
            health: Some(0.8),
        }),
        kit_id: Some("test-kit".to_string()),
        kit_kind: Some("test".to_string()),
        kit_role: "test-role".to_string(),
    }
}

fn test_terrain_detail_decay_consumer(
    id: &str,
    resource: ResourceKind,
    amount: u32,
    x: f32,
    y: f32,
) -> TerrainDetailAuthorityDecayConsumer {
    TerrainDetailAuthorityDecayConsumer {
        id: id.to_string(),
        x,
        y,
        consumes: vec![TerrainDetailAuthorityConsumeRequirement {
            kind: resource,
            amount,
        }],
    }
}
