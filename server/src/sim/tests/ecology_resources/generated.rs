use super::*;

#[test]
fn generated_ecology_objects_are_addressable_resource_nodes() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);

    let snapshot = sim.snapshot(empty_settlement());
    assert_eq!(
        snapshot
            .objects
            .iter()
            .filter(|object| matches!(
                object.kind,
                ObjectKind::SaplingTree
                    | ObjectKind::Deadwood
                    | ObjectKind::MyceliumPatch
                    | ObjectKind::FieldCoil
                    | ObjectKind::Ruin
            ))
            .count(),
        11
    );

    let deadwood = snapshot
        .objects
        .iter()
        .find(|object| object.id == "fallen-grove-log")
        .expect("generated deadwood should be present");
    assert_eq!(deadwood.kind, ObjectKind::Deadwood);
    assert_eq!(deadwood.resources[0].kind, ResourceKind::Deadwood);
    assert_eq!(
        deadwood
            .lifecycle
            .as_ref()
            .map(|lifecycle| lifecycle.stage.as_str()),
        Some("freshfall")
    );
    let deadwood_lifecycle = deadwood
        .lifecycle
        .as_ref()
        .expect("deadwood should expose lifecycle");
    assert_eq!(deadwood_lifecycle.family, "deadwood");
    assert_eq!(deadwood_lifecycle.species.as_deref(), Some("fallen-ash"));
    assert_eq!(deadwood_lifecycle.age_years, Some(3));
    assert!(deadwood_lifecycle.health > 0.0 && deadwood_lifecycle.health < 0.35);

    let decaying_stump = snapshot
        .objects
        .iter()
        .find(|object| object.id == "decaying-grove-stump")
        .expect("decaying stump should be present");
    assert_eq!(decaying_stump.kind, ObjectKind::Deadwood);
    assert_eq!(decaying_stump.resources[0].kind, ResourceKind::Deadwood);
    assert_eq!(decaying_stump.resources[0].amount, 2);
    let stump_lifecycle = decaying_stump
        .lifecycle
        .as_ref()
        .expect("decaying stump should expose lifecycle");
    assert_eq!(stump_lifecycle.family, "deadwood");
    assert_eq!(stump_lifecycle.stage, "decaying");
    assert_eq!(stump_lifecycle.species.as_deref(), Some("mossheart-fall"));
    assert_eq!(stump_lifecycle.age_years, Some(9));
    assert!(stump_lifecycle.health > 0.0 && stump_lifecycle.health < deadwood_lifecycle.health);

    let sapling = snapshot
        .objects
        .iter()
        .find(|object| object.id == "young-grove-sapling")
        .expect("generated sapling should be present");
    let sapling_lifecycle = sapling
        .lifecycle
        .as_ref()
        .expect("sapling should expose lifecycle");
    assert_eq!(sapling_lifecycle.family, "tree");
    assert_eq!(sapling_lifecycle.stage, "sapling");
    assert_eq!(sapling_lifecycle.species.as_deref(), Some("greenwood"));
    assert_eq!(sapling_lifecycle.age_years, Some(7));
    assert!(sapling_lifecycle.health > 0.6 && sapling_lifecycle.health <= 1.0);

    let mature_tree = snapshot
        .objects
        .iter()
        .find(|object| object.id == "mossheart-grove-tree")
        .expect("mature generated tree should be present");
    assert_eq!(mature_tree.kind, ObjectKind::SaplingTree);
    assert_eq!(mature_tree.resources[0].kind, ResourceKind::Wood);
    let mature_lifecycle = mature_tree
        .lifecycle
        .as_ref()
        .expect("mature tree should expose lifecycle");
    assert_eq!(mature_lifecycle.family, "tree");
    assert_eq!(mature_lifecycle.stage, "mature");
    assert_eq!(mature_lifecycle.species.as_deref(), Some("shadebark"));
    assert_eq!(mature_lifecycle.age_years, Some(64));
    assert!(mature_lifecycle.health > 0.55);

    let ancient_tree = snapshot
        .objects
        .iter()
        .find(|object| object.id == "ancient-ironleaf-tree")
        .expect("ancient generated tree should be present");
    assert_eq!(ancient_tree.kind, ObjectKind::SaplingTree);
    assert_eq!(ancient_tree.resources[0].kind, ResourceKind::Wood);
    let ancient_lifecycle = ancient_tree
        .lifecycle
        .as_ref()
        .expect("ancient tree should expose lifecycle");
    assert_eq!(ancient_lifecycle.family, "tree");
    assert_eq!(ancient_lifecycle.stage, "ancient");
    assert_eq!(ancient_lifecycle.species.as_deref(), Some("ironleaf"));
    assert_eq!(ancient_lifecycle.age_years, Some(183));
    assert!(ancient_lifecycle.health > 0.6);

    let stormroot_coil = snapshot
        .objects
        .iter()
        .find(|object| object.id == "stormroot-field-coil")
        .expect("stormroot coil should be present");
    assert_eq!(stormroot_coil.kind, ObjectKind::FieldCoil);
    assert_eq!(stormroot_coil.resources[0].kind, ResourceKind::Charge);
    assert_eq!(stormroot_coil.resources[0].amount, 1);
    let stormroot_lifecycle = stormroot_coil
        .lifecycle
        .as_ref()
        .expect("stormroot coil should expose lifecycle");
    assert_eq!(stormroot_lifecycle.family, "machine");
    assert_eq!(stormroot_lifecycle.stage, "sparking");
    assert_eq!(stormroot_lifecycle.species.as_deref(), Some("stormroot"));
    assert_eq!(stormroot_lifecycle.age_years, Some(4));

    let ruin = snapshot
        .objects
        .iter()
        .find(|object| object.id == "ancient-viaduct-ruin")
        .expect("ancient ruin should be present");
    assert_eq!(ruin.kind, ObjectKind::Ruin);
    assert_eq!(ruin.resources[0].kind, ResourceKind::Stone);
    assert_eq!(ruin.resources[0].amount, 2);
    let ruin_lifecycle = ruin
        .lifecycle
        .as_ref()
        .expect("ruin should expose lifecycle");
    assert_eq!(ruin_lifecycle.family, "mineral");
    assert_eq!(ruin_lifecycle.stage, "ancient-ruin");
    assert_eq!(
        ruin_lifecycle.species.as_deref(),
        Some("sunken-viaduct-stone")
    );
    assert_eq!(ruin_lifecycle.age_years, Some(128_000));
    assert!(ruin_lifecycle.decay > 0.5);
    assert!(ruin_lifecycle.health > 0.0 && ruin_lifecycle.health < 0.3);

    move_player_to_object(&mut sim, player_id, "fallen-grove-log", 8.0, 0.0);
    sim.set_input(
        player_id,
        PlayerInput {
            interact: true,
            ..PlayerInput::default()
        },
    );
    let outcome = sim.tick(0.05);
    assert_eq!(outcome.resource_events.len(), 1);
    assert_eq!(outcome.resource_events[0].resource, ResourceKind::Deadwood);
    assert_eq!(
        outcome.resource_node_events[0].object_id,
        "fallen-grove-log"
    );
    assert_eq!(outcome.resource_node_events[0].amount, 3);

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert_eq!(player.resources.deadwood, 1);
    assert!(player
        .inventory
        .items
        .iter()
        .any(|item| item.item_id == "deadwood" && item.label == "Deadwood"));

    sim.set_input(player_id, PlayerInput::default());
    let _ = sim.tick(0.05);
    move_player_to_object(&mut sim, player_id, "shrine-mycelium-bloom", 8.0, 0.0);
    sim.set_input(
        player_id,
        PlayerInput {
            interact: true,
            ..PlayerInput::default()
        },
    );
    let outcome = sim.tick(0.05);
    assert_eq!(outcome.resource_feed_events.len(), 1);
    assert_eq!(
        outcome.resource_feed_events[0].input_resource,
        ResourceKind::Deadwood
    );
    assert_eq!(
        outcome.resource_feed_events[0].output_resource,
        ResourceKind::Mycelium
    );
    assert_eq!(outcome.resource_feed_events[0].input_total, 0);
    assert_eq!(outcome.resource_feed_events[0].output_total, 4);
    assert_eq!(
        outcome.resource_node_events[0].object_id,
        "shrine-mycelium-bloom"
    );
    assert_eq!(outcome.resource_node_events[0].amount, 4);

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert_eq!(player.resources.deadwood, 0);
    let bloom = snapshot
        .objects
        .iter()
        .find(|object| object.id == "shrine-mycelium-bloom")
        .expect("mycelium bloom should remain in snapshot");
    assert_eq!(bloom.resources[0].amount, 4);
    assert_eq!(
        bloom
            .lifecycle
            .as_ref()
            .map(|lifecycle| lifecycle.stage.as_str()),
        Some("blooming")
    );

    sim.set_input(player_id, PlayerInput::default());
    let _ = sim.tick(0.05);
    move_player_to_object(&mut sim, player_id, "field-coil", 8.0, 0.0);
    sim.set_input(
        player_id,
        PlayerInput {
            interact: true,
            ..PlayerInput::default()
        },
    );
    let outcome = sim.tick(0.05);
    assert_eq!(outcome.resource_events.len(), 1);
    assert_eq!(outcome.resource_events[0].resource, ResourceKind::Charge);
    assert_eq!(outcome.resource_node_events[0].object_id, "field-coil");

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert_eq!(player.resources.charge, 1);
    assert!(player
        .inventory
        .items
        .iter()
        .any(|item| item.item_id == "charge" && item.label == "Charge"));
}
