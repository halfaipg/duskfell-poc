use super::*;
use std::collections::HashMap;
use uuid::Uuid;

#[test]
fn inventory_resource_stacks_are_bounded() {
    let mut inventory = PlayerInventory::default();
    assert_eq!(
        inventory.add_resource(ResourceKind::Wood, INVENTORY_STACK_LIMIT - 1),
        Some(INVENTORY_STACK_LIMIT - 1)
    );
    assert_eq!(
        inventory.add_resource(ResourceKind::Wood, 10),
        Some(INVENTORY_STACK_LIMIT)
    );
    assert_eq!(inventory.add_resource(ResourceKind::Wood, 1), None);

    let snapshot = inventory.snapshot();
    assert_eq!(snapshot.items.len(), 1);
    assert_eq!(snapshot.items[0].item_id, "wood");
    assert_eq!(snapshot.items[0].quantity, INVENTORY_STACK_LIMIT);
}

#[test]
fn crafting_near_forge_consumes_resources_and_adds_crafted_item() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);

    let entity = sim.players.get(&player_id).copied().expect("player exists");
    {
        let mut player = sim
            .world
            .get_mut::<Player>(entity)
            .expect("player component");
        assert_eq!(
            player.inventory.add_resource(ResourceKind::Wood, 1),
            Some(1)
        );
        assert_eq!(player.inventory.add_resource(ResourceKind::Ore, 1), Some(1));
    }
    move_player_to_object(&mut sim, player_id, "field-forge", 8.0, 0.0);

    sim.set_input(
        player_id,
        PlayerInput {
            interact: true,
            ..PlayerInput::default()
        },
    );
    let outcome = sim.tick(0.05);

    assert!(outcome.settlement_jobs.is_empty());
    assert!(outcome.resource_events.is_empty());
    assert_eq!(outcome.crafting_events.len(), 1);
    assert_eq!(outcome.crafting_events[0].player_id, player_id);
    assert_eq!(outcome.crafting_events[0].object_id, "field-forge");
    assert_eq!(outcome.crafting_events[0].item_id, "trail-kit");
    assert_eq!(outcome.crafting_events[0].amount, 1);
    assert_eq!(outcome.crafting_events[0].total, 1);

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert_eq!(player.resources.wood, 0);
    assert_eq!(player.resources.ore, 0);
    assert_eq!(player.inventory.items.len(), 1);
    assert_eq!(player.inventory.items[0].item_id, "trail-kit");
    assert_eq!(player.inventory.items[0].label, "Trail Kit");
    assert_eq!(player.inventory.items[0].quantity, 1);
    let lifecycle = player.inventory.items[0]
        .lifecycle
        .as_ref()
        .expect("crafted item should expose lifecycle");
    assert_eq!(lifecycle.family, "crafted");
    assert_eq!(lifecycle.stage, "fresh");
    assert_eq!(lifecycle.age_years, 0);
    assert!(lifecycle.compostable);
}

#[test]
fn mycelium_can_compost_crafted_inventory_items() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);

    let entity = sim.players.get(&player_id).copied().expect("player exists");
    {
        let mut player = sim
            .world
            .get_mut::<Player>(entity)
            .expect("player component");
        assert_eq!(
            player.inventory.add_resource(ResourceKind::Wood, 1),
            Some(1)
        );
        assert_eq!(player.inventory.add_resource(ResourceKind::Ore, 1), Some(1));
    }

    move_player_to_object(&mut sim, player_id, "field-forge", 8.0, 0.0);
    sim.set_input(
        player_id,
        PlayerInput {
            interact: true,
            ..PlayerInput::default()
        },
    );
    let craft_outcome = sim.tick(0.05);
    assert_eq!(craft_outcome.crafting_events.len(), 1);
    assert_eq!(craft_outcome.crafting_events[0].item_id, "trail-kit");

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
    let feed_outcome = sim.tick(0.05);

    assert!(feed_outcome.resource_feed_events.is_empty());
    assert_eq!(feed_outcome.item_feed_events.len(), 1);
    assert_eq!(feed_outcome.item_feed_events[0].player_id, player_id);
    assert_eq!(
        feed_outcome.item_feed_events[0].object_id,
        "shrine-mycelium-bloom"
    );
    assert_eq!(feed_outcome.item_feed_events[0].item_id, "trail-kit");
    assert_eq!(feed_outcome.item_feed_events[0].item_label, "Trail Kit");
    assert_eq!(feed_outcome.item_feed_events[0].input_amount, 1);
    assert_eq!(feed_outcome.item_feed_events[0].input_total, 0);
    assert_eq!(
        feed_outcome.item_feed_events[0].output_resource,
        ResourceKind::Mycelium
    );
    assert_eq!(feed_outcome.item_feed_events[0].output_amount, 1);
    assert_eq!(feed_outcome.item_feed_events[0].output_total, 4);
    assert_node_event(
        &feed_outcome.resource_node_events,
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
    assert_eq!(player.resources.wood, 0);
    assert_eq!(player.resources.ore, 0);
    assert!(player
        .inventory
        .items
        .iter()
        .all(|item| item.item_id != "trail-kit"));
    let bloom = snapshot
        .objects
        .iter()
        .find(|object| object.id == "shrine-mycelium-bloom")
        .expect("mycelium bloom should remain in snapshot");
    assert_eq!(bloom.resources[0].amount, 4);
}

#[test]
fn decayed_crafted_items_feed_mycelium_more_than_fresh_items() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    sim.apply_resource_node_replay(&HashMap::from([(
        "shrine-mycelium-bloom".to_string(),
        (ResourceKind::Mycelium, 1),
    )]));

    let entity = sim.players.get(&player_id).copied().expect("player exists");
    {
        let mut player = sim
            .world
            .get_mut::<Player>(entity)
            .expect("player component");
        assert_eq!(
            player
                .inventory
                .add_item(InventoryItemKind::Crafted(CraftedItemKind::TrailKit), 1),
            Some(1)
        );
        let stack = player
            .inventory
            .stacks
            .iter_mut()
            .find(|stack| stack.item == InventoryItemKind::Crafted(CraftedItemKind::TrailKit))
            .expect("trail kit stack should exist");
        stack.age_years = 8;
    }

    let snapshot = sim.snapshot(empty_settlement());
    let trail_kit = snapshot.players[0]
        .inventory
        .items
        .iter()
        .find(|item| item.item_id == "trail-kit")
        .expect("trail kit should be present");
    let lifecycle = trail_kit
        .lifecycle
        .as_ref()
        .expect("trail kit should expose lifecycle");
    assert_eq!(lifecycle.stage, "composting");

    move_player_to_object(&mut sim, player_id, "shrine-mycelium-bloom", 8.0, 0.0);
    sim.set_input(
        player_id,
        PlayerInput {
            interact: true,
            ..PlayerInput::default()
        },
    );
    let outcome = sim.tick(0.05);

    assert_eq!(outcome.item_feed_events.len(), 1);
    assert_eq!(outcome.item_feed_events[0].output_amount, 3);
    assert_eq!(outcome.item_feed_events[0].output_total, 4);
    assert_node_event(
        &outcome.resource_node_events,
        "shrine-mycelium-bloom",
        ResourceKind::Mycelium,
        4,
    );
}

#[test]
fn inventory_item_lifecycles_age_on_authoritative_ticks() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);

    let entity = sim.players.get(&player_id).copied().expect("player exists");
    {
        let mut player = sim
            .world
            .get_mut::<Player>(entity)
            .expect("player component");
        assert_eq!(
            player
                .inventory
                .add_item(InventoryItemKind::Crafted(CraftedItemKind::TrailKit), 1),
            Some(1)
        );
    }

    let before = sim.snapshot(empty_settlement());
    let before_item = before.players[0]
        .inventory
        .items
        .iter()
        .find(|item| item.item_id == "trail-kit")
        .expect("trail kit should be present");
    let before_lifecycle = before_item
        .lifecycle
        .as_ref()
        .expect("trail kit lifecycle should be present");
    assert_eq!(before_lifecycle.age_years, 0);
    assert_eq!(before_lifecycle.stage, "fresh");

    sim.tick(1.0);

    let after = sim.snapshot(empty_settlement());
    let after_item = after.players[0]
        .inventory
        .items
        .iter()
        .find(|item| item.item_id == "trail-kit")
        .expect("trail kit should remain present");
    let after_lifecycle = after_item
        .lifecycle
        .as_ref()
        .expect("trail kit lifecycle should remain present");
    assert_eq!(after_lifecycle.age_years, 1);
    assert_eq!(after_lifecycle.stage, "weathered");
    assert!(
        after_lifecycle.decay > before_lifecycle.decay,
        "inventory decay should increase as item age advances"
    );
    assert!(
        after_lifecycle.health < before_lifecycle.health,
        "inventory health should wear down as item age advances"
    );
    assert!(after_lifecycle.compostable);
}

#[test]
fn composting_inventory_items_shed_spores_on_authoritative_ticks() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);

    let entity = sim.players.get(&player_id).copied().expect("player exists");
    {
        let mut player = sim
            .world
            .get_mut::<Player>(entity)
            .expect("player component");
        assert_eq!(
            player
                .inventory
                .add_item(InventoryItemKind::Crafted(CraftedItemKind::TrailKit), 1),
            Some(1)
        );
        let stack = player
            .inventory
            .stacks
            .iter_mut()
            .find(|stack| stack.item == InventoryItemKind::Crafted(CraftedItemKind::TrailKit))
            .expect("trail kit stack should exist");
        stack.age_years = 8;
    }

    let mut outcome = SimTickOutcome::default();
    for _ in 0..INVENTORY_COMPOST_SPORE_INTERVAL_TICKS {
        outcome = sim.tick(0.05);
    }

    assert_eq!(outcome.item_decay_events.len(), 1);
    assert_eq!(outcome.item_decay_events[0].player_id, player_id);
    assert_eq!(outcome.item_decay_events[0].target_object_id, None);
    assert_eq!(outcome.item_decay_events[0].item_id, "trail-kit");
    assert_eq!(outcome.item_decay_events[0].item_label, "Trail Kit");
    assert_eq!(outcome.item_decay_events[0].item_stage, "composting");
    assert_eq!(
        outcome.item_decay_events[0].output_resource,
        ResourceKind::Spores
    );
    assert_eq!(outcome.item_decay_events[0].output_amount, 1);
    assert_eq!(outcome.item_decay_events[0].output_total, 1);

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert_eq!(player.resources.spores, 1);
    assert!(player
        .inventory
        .items
        .iter()
        .any(|item| item.item_id == "spores" && item.quantity == 1));
    assert!(player
        .inventory
        .items
        .iter()
        .any(|item| item.item_id == "trail-kit" && item.quantity == 1));
}

#[test]
fn composting_inventory_items_feed_nearby_hungry_mycelium_before_inventory_spores() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    sim.apply_resource_node_replay(&HashMap::from([(
        "shrine-mycelium-bloom".to_string(),
        (ResourceKind::Mycelium, 1),
    )]));

    let entity = sim.players.get(&player_id).copied().expect("player exists");
    {
        let mut player = sim
            .world
            .get_mut::<Player>(entity)
            .expect("player component");
        assert_eq!(
            player
                .inventory
                .add_item(InventoryItemKind::Crafted(CraftedItemKind::TrailKit), 1),
            Some(1)
        );
        let stack = player
            .inventory
            .stacks
            .iter_mut()
            .find(|stack| stack.item == InventoryItemKind::Crafted(CraftedItemKind::TrailKit))
            .expect("trail kit stack should exist");
        stack.age_years = 8;
    }
    move_player_to_object(&mut sim, player_id, "shrine-mycelium-bloom", 8.0, 0.0);

    let mut outcome = SimTickOutcome::default();
    for _ in 0..INVENTORY_COMPOST_SPORE_INTERVAL_TICKS {
        outcome = sim.tick(0.05);
    }

    assert_eq!(outcome.item_decay_events.len(), 1);
    assert_eq!(
        outcome.item_decay_events[0].target_object_id.as_deref(),
        Some("shrine-mycelium-bloom")
    );
    assert_eq!(outcome.item_decay_events[0].item_id, "trail-kit");
    assert_eq!(
        outcome.item_decay_events[0].output_resource,
        ResourceKind::Mycelium
    );
    assert_eq!(outcome.item_decay_events[0].output_amount, 1);
    assert_eq!(outcome.item_decay_events[0].output_total, 3);
    assert_node_event(
        &outcome.resource_node_events,
        "shrine-mycelium-bloom",
        ResourceKind::Mycelium,
        3,
    );

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert_eq!(player.resources.spores, 0);
    let bloom = snapshot
        .objects
        .iter()
        .find(|object| object.id == "shrine-mycelium-bloom")
        .expect("mycelium bloom should remain in snapshot");
    assert_eq!(bloom.resources[0].amount, 4);
}

#[test]
fn crafting_without_recipe_resources_does_not_mint_items() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    move_player_to_object(&mut sim, player_id, "field-forge", 8.0, 0.0);

    sim.set_input(
        player_id,
        PlayerInput {
            interact: true,
            ..PlayerInput::default()
        },
    );
    let outcome = sim.tick(0.05);

    assert!(outcome.settlement_jobs.is_empty());
    assert!(outcome.resource_events.is_empty());
    assert!(outcome.crafting_events.is_empty());

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert!(player.inventory.items.is_empty());
    assert_eq!(player.resources.wood, 0);
    assert_eq!(player.resources.ore, 0);
}
