use super::*;

#[test]
fn resource_lifecycles_age_on_authoritative_ticks() {
    let mut sim = SimWorld::new();
    let before = sim.snapshot(empty_settlement());
    let before_deadwood = before
        .objects
        .iter()
        .find(|object| object.id == "fallen-grove-log")
        .and_then(|object| object.lifecycle.as_ref())
        .expect("fallen log should expose lifecycle before aging");

    sim.tick(1.0);

    let after = sim.snapshot(empty_settlement());
    let after_deadwood = after
        .objects
        .iter()
        .find(|object| object.id == "fallen-grove-log")
        .and_then(|object| object.lifecycle.as_ref())
        .expect("fallen log should expose lifecycle after aging");

    assert_eq!(
        after_deadwood.age_years,
        before_deadwood.age_years.map(|age| age + 1)
    );
    assert!(
        after_deadwood.health < before_deadwood.health,
        "deadwood health should wear down as lifecycle age advances"
    );
    assert!(
        after_deadwood.decay > before_deadwood.decay,
        "deadwood decay should intensify as lifecycle age advances"
    );
}

#[test]
fn deadwood_near_mycelium_decays_into_bloom_growth() {
    let mut sim = SimWorld::new();
    let snapshot = sim.snapshot(empty_settlement());
    let stump = snapshot
        .objects
        .iter()
        .find(|object| object.id == "decaying-grove-stump")
        .expect("decaying stump should be present");
    let bloom = snapshot
        .objects
        .iter()
        .find(|object| object.id == "shrine-mycelium-bloom")
        .expect("mycelium bloom should be present");
    let hollow_stump = snapshot
        .objects
        .iter()
        .find(|object| object.id == "hollow-grove-stump")
        .expect("hollow stump should be present");
    let runner = snapshot
        .objects
        .iter()
        .find(|object| object.id == "veilcap-runner")
        .expect("veilcap runner should be present");
    assert_eq!(stump.resources[0].amount, 2);
    assert_eq!(bloom.resources[0].amount, 3);
    assert_eq!(hollow_stump.resources[0].amount, 1);
    assert_eq!(runner.resources[0].amount, 1);

    let mut last_outcome = SimTickOutcome::default();
    for _ in 0..ECOLOGY_DECAY_FEED_INTERVAL_TICKS {
        last_outcome = sim.tick(0.05);
    }

    assert_eq!(last_outcome.resource_events.len(), 0);
    assert_eq!(last_outcome.resource_feed_events.len(), 0);
    assert_eq!(last_outcome.resource_node_events.len(), 4);
    assert_node_event(
        &last_outcome.resource_node_events,
        "decaying-grove-stump",
        ResourceKind::Deadwood,
        1,
    );
    assert_node_event(
        &last_outcome.resource_node_events,
        "shrine-mycelium-bloom",
        ResourceKind::Mycelium,
        4,
    );
    assert_node_event(
        &last_outcome.resource_node_events,
        "hollow-grove-stump",
        ResourceKind::Deadwood,
        0,
    );
    assert_node_event(
        &last_outcome.resource_node_events,
        "veilcap-runner",
        ResourceKind::Mycelium,
        2,
    );

    let snapshot = sim.snapshot(empty_settlement());
    let stump = snapshot
        .objects
        .iter()
        .find(|object| object.id == "decaying-grove-stump")
        .expect("decaying stump should remain in snapshot");
    let bloom = snapshot
        .objects
        .iter()
        .find(|object| object.id == "shrine-mycelium-bloom")
        .expect("mycelium bloom should remain in snapshot");
    assert_eq!(stump.resources[0].amount, 1);
    assert_eq!(bloom.resources[0].amount, 4);
    let hollow_stump = snapshot
        .objects
        .iter()
        .find(|object| object.id == "hollow-grove-stump")
        .expect("hollow stump should remain in snapshot");
    let runner = snapshot
        .objects
        .iter()
        .find(|object| object.id == "veilcap-runner")
        .expect("veilcap runner should remain in snapshot");
    assert_eq!(hollow_stump.resources[0].amount, 0);
    assert_eq!(runner.resources[0].amount, 2);
    assert_eq!(
        bloom
            .lifecycle
            .as_ref()
            .map(|lifecycle| lifecycle.stage.as_str()),
        Some("blooming")
    );
}

#[test]
fn mycelium_consumes_organic_inventory_items() {
    let mut sim = SimWorld::new();
    let player_id = Uuid::new_v4();
    sim.add_player(player_id);

    move_player_to_object(&mut sim, player_id, "young-grove-sapling", 8.0, 0.0);
    sim.set_input(
        player_id,
        PlayerInput {
            interact: true,
            ..PlayerInput::default()
        },
    );
    let outcome = sim.tick(0.05);
    assert_eq!(outcome.resource_events.len(), 1);
    assert_eq!(outcome.resource_events[0].resource, ResourceKind::Seed);
    assert_node_event(
        &outcome.resource_node_events,
        "young-grove-sapling",
        ResourceKind::Seed,
        0,
    );

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert_eq!(player.resources.seed, 1);
    assert!(player
        .inventory
        .items
        .iter()
        .any(|item| item.item_id == "seed" && item.label == "Seed"));

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
        ResourceKind::Seed
    );
    assert_eq!(outcome.resource_feed_events[0].input_total, 0);
    assert_eq!(
        outcome.resource_feed_events[0].output_resource,
        ResourceKind::Mycelium
    );
    assert_eq!(outcome.resource_feed_events[0].output_total, 4);
    assert_node_event(
        &outcome.resource_node_events,
        "shrine-mycelium-bloom",
        ResourceKind::Mycelium,
        4,
    );

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert_eq!(player.resources.seed, 0);
    let bloom = snapshot
        .objects
        .iter()
        .find(|object| object.id == "shrine-mycelium-bloom")
        .expect("mycelium bloom should remain in snapshot");
    assert_eq!(bloom.resources[0].amount, 4);
}

#[test]
fn charged_field_coil_energizes_nearby_mycelium() {
    let mut sim = SimWorld::new();
    let mut states = HashMap::new();
    states.insert(
        "hollow-grove-stump".to_string(),
        (ResourceKind::Deadwood, 0),
    );
    assert_eq!(sim.apply_resource_node_replay(&states), 1);

    let snapshot = sim.snapshot(empty_settlement());
    let coil = snapshot
        .objects
        .iter()
        .find(|object| object.id == "stormroot-field-coil")
        .expect("stormroot coil should be present");
    let runner = snapshot
        .objects
        .iter()
        .find(|object| object.id == "veilcap-runner")
        .expect("veilcap runner should be present");
    assert_eq!(coil.resources[0].amount, 1);
    assert_eq!(runner.resources[0].amount, 1);

    let mut last_outcome = SimTickOutcome::default();
    for _ in 0..COIL_MYCELIUM_CHARGE_INTERVAL_TICKS {
        last_outcome = sim.tick(0.05);
    }

    assert_eq!(last_outcome.resource_events.len(), 0);
    assert_eq!(last_outcome.resource_feed_events.len(), 0);
    assert_node_event(
        &last_outcome.resource_node_events,
        "stormroot-field-coil",
        ResourceKind::Charge,
        0,
    );
    assert_node_event(
        &last_outcome.resource_node_events,
        "veilcap-runner",
        ResourceKind::Mycelium,
        2,
    );

    let snapshot = sim.snapshot(empty_settlement());
    let coil = snapshot
        .objects
        .iter()
        .find(|object| object.id == "stormroot-field-coil")
        .expect("stormroot coil should remain in snapshot");
    let runner = snapshot
        .objects
        .iter()
        .find(|object| object.id == "veilcap-runner")
        .expect("veilcap runner should remain in snapshot");
    assert_eq!(coil.resources[0].amount, 0);
    assert_eq!(
        coil.lifecycle
            .as_ref()
            .map(|lifecycle| lifecycle.stage.as_str()),
        Some("spent")
    );
    assert_eq!(runner.resources[0].amount, 2);
    assert_eq!(
        runner
            .lifecycle
            .as_ref()
            .map(|lifecycle| lifecycle.stage.as_str()),
        Some("fruiting")
    );
}
