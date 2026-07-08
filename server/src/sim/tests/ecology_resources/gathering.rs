use super::*;

#[test]
fn gathering_near_resource_nodes_updates_bounded_player_resources() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    move_player_to_object(&mut sim, player_id, "north-grove", 8.0, 0.0);

    sim.set_input(
        player_id,
        PlayerInput {
            interact: true,
            ..PlayerInput::default()
        },
    );
    let outcome = sim.tick(0.05);
    assert!(outcome.settlement_jobs.is_empty());
    assert_eq!(outcome.resource_events.len(), 1);
    assert_eq!(outcome.resource_events[0].player_id, player_id);
    assert_eq!(outcome.resource_events[0].object_id, "north-grove");
    assert_eq!(outcome.resource_events[0].resource, ResourceKind::Wood);
    assert_eq!(outcome.resource_events[0].amount, 1);
    assert_eq!(outcome.resource_events[0].total, 1);
    assert_eq!(outcome.resource_node_events.len(), 2);
    assert_node_event(
        &outcome.resource_node_events,
        "north-grove",
        ResourceKind::Wood,
        7,
    );
    assert_node_event(
        &outcome.resource_node_events,
        "fallen-grove-log",
        ResourceKind::Deadwood,
        5,
    );

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert_eq!(player.resources.wood, 1);
    assert_eq!(player.resources.ore, 0);
    assert_eq!(player.inventory.capacity_slots, INVENTORY_CAPACITY_SLOTS);
    assert_eq!(player.inventory.items.len(), 1);
    assert_eq!(player.inventory.items[0].item_id, "wood");
    assert_eq!(player.inventory.items[0].quantity, 1);
    let grove = snapshot
        .objects
        .iter()
        .find(|object| object.id == "north-grove")
        .expect("grove should remain in snapshot");
    assert_eq!(grove.resources[0].kind, ResourceKind::Wood);
    assert_eq!(grove.resources[0].amount, 7);
    assert_eq!(grove.resources[0].max_amount, 12);
    assert_eq!(
        grove
            .lifecycle
            .as_ref()
            .map(|lifecycle| lifecycle.stage.as_str()),
        Some("mature")
    );
    let fallen_log = snapshot
        .objects
        .iter()
        .find(|object| object.id == "fallen-grove-log")
        .expect("fallen log should remain in snapshot");
    assert_eq!(fallen_log.resources[0].kind, ResourceKind::Deadwood);
    assert_eq!(fallen_log.resources[0].amount, 5);

    let held_key_outcome = sim.tick(0.05);
    assert!(held_key_outcome.resource_events.is_empty());

    sim.set_input(player_id, PlayerInput::default());
    sim.tick(0.05);
    move_player_to_object(&mut sim, player_id, "east-ore", -8.0, 0.0);
    sim.set_input(
        player_id,
        PlayerInput {
            interact: true,
            ..PlayerInput::default()
        },
    );
    let ore_outcome = sim.tick(0.05);
    assert_eq!(ore_outcome.resource_events.len(), 1);
    assert_eq!(ore_outcome.resource_events[0].resource, ResourceKind::Ore);

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert_eq!(player.resources.wood, 1);
    assert_eq!(player.resources.ore, 1);
    assert_eq!(player.inventory.items.len(), 2);
    assert!(player
        .inventory
        .items
        .iter()
        .any(|item| item.item_id == "ore" && item.quantity == 1));
}

#[test]
fn resource_nodes_deplete_regrow_and_expose_decay_resources() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    move_player_to_object(&mut sim, player_id, "old-shrine", 8.0, 0.0);

    sim.set_input(
        player_id,
        PlayerInput {
            interact: true,
            ..PlayerInput::default()
        },
    );
    let outcome = sim.tick(0.05);
    assert_eq!(outcome.resource_events.len(), 1);
    assert_eq!(outcome.resource_events[0].resource, ResourceKind::Mycelium);
    assert_eq!(outcome.resource_node_events.len(), 1);
    assert_eq!(outcome.resource_node_events[0].object_id, "old-shrine");
    assert_eq!(
        outcome.resource_node_events[0].resource,
        ResourceKind::Mycelium
    );
    assert_eq!(outcome.resource_node_events[0].amount, 4);

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert_eq!(player.resources.mycelium, 1);
    assert!(player
        .inventory
        .items
        .iter()
        .any(|item| item.item_id == "mycelium" && item.label == "Mycelium"));
    let shrine = snapshot
        .objects
        .iter()
        .find(|object| object.id == "old-shrine")
        .expect("shrine should remain in snapshot");
    assert_eq!(shrine.resources[0].kind, ResourceKind::Mycelium);
    assert_eq!(shrine.resources[0].amount, 4);
    assert_eq!(shrine.resources[0].max_amount, 7);
    let lifecycle = shrine
        .lifecycle
        .as_ref()
        .expect("resource node has lifecycle");
    assert_eq!(lifecycle.family, "mycelium");
    assert_eq!(lifecycle.stage, "fruiting");
    assert_eq!(lifecycle.species.as_deref(), Some("shrine-thread"));
    assert_eq!(lifecycle.age_years, Some(19));
    assert!(lifecycle.health > 0.0 && lifecycle.health <= 1.0);
    assert!(lifecycle.decay > 0.0);

    let mut regenerated = false;
    for _ in 0..30 {
        let outcome = sim.tick(1.0);
        regenerated |= outcome
            .resource_node_events
            .iter()
            .any(|event| event.object_id == "old-shrine" && event.amount > 4);
    }
    assert!(
        regenerated,
        "expected mycelium node regen to emit a durable node change"
    );
    let snapshot = sim.snapshot(empty_settlement());
    let shrine = snapshot
        .objects
        .iter()
        .find(|object| object.id == "old-shrine")
        .expect("shrine should remain in snapshot");
    assert!(
        shrine.resources[0].amount > 4,
        "expected mycelium node to regenerate after enough simulated time"
    );
}
