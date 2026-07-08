use super::*;
use uuid::Uuid;

#[test]
fn player_snapshot_color_matches_client_hex_contract() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");

    assert_eq!(player.color.len(), 7);
    assert!(player.color.starts_with('#'));
    assert!(player.color[1..].chars().all(|ch| ch.is_ascii_hexdigit()));
}

#[test]
fn player_snapshot_filters_distant_players_and_keeps_self() {
    let near_player = Uuid::new_v4();
    let far_player = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(near_player);
    sim.add_player(far_player);

    let far_entity = sim.players.get(&far_player).copied().expect("far player");
    let mut far_position = sim
        .world
        .get_mut::<Position>(far_entity)
        .expect("far position");
    far_position.x = sim.map.width - 40.0;
    far_position.y = sim.map.height - 40.0;

    let snapshot = sim.snapshot_for_player(near_player, empty_settlement(), INTEREST_RADIUS);
    assert!(snapshot
        .players
        .iter()
        .any(|player| player.id == near_player));
    assert!(!snapshot
        .players
        .iter()
        .any(|player| player.id == far_player));
}

#[test]
fn player_snapshot_uses_configured_interest_radius() {
    let player_a = Uuid::new_v4();
    let player_b = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_a);
    sim.add_player(player_b);
    let a_position = player_position(&sim, player_a);
    move_player_to_position(
        &mut sim,
        player_b,
        Position {
            x: a_position.x + 50.0,
            y: a_position.y,
        },
    );

    let tight = sim.snapshot_for_player(player_a, empty_settlement(), 20.0);
    assert!(tight.players.iter().any(|player| player.id == player_a));
    assert!(!tight.players.iter().any(|player| player.id == player_b));

    let wider = sim.snapshot_for_player(player_a, empty_settlement(), 80.0);
    assert!(wider.players.iter().any(|player| player.id == player_a));
    assert!(wider.players.iter().any(|player| player.id == player_b));
}

#[test]
fn validates_player_names_explicitly() {
    assert_eq!(
        validate_player_name("  Wayfarer_7  ").expect("valid name"),
        "Wayfarer_7"
    );
    assert_eq!(validate_player_name("   "), Err(PlayerNameError::Empty));
    assert_eq!(
        validate_player_name("Wayfarer With Space"),
        Err(PlayerNameError::InvalidCharacters)
    );
    assert_eq!(
        validate_player_name("Wayfarer<script>"),
        Err(PlayerNameError::InvalidCharacters)
    );
    assert_eq!(
        validate_player_name("ABCDEFGHIJKLMNOPQRSTU"),
        Err(PlayerNameError::TooLong {
            max: PLAYER_NAME_MAX_CHARS,
        })
    );
}

#[test]
fn rename_player_rejects_invalid_names_without_mutating_snapshot() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);

    assert_eq!(
        sim.rename_player(player_id, "Good_Name-7")
            .expect("valid rename"),
        Some("Good_Name-7".to_string())
    );
    assert_eq!(
        sim.rename_player(player_id, "<bad>"),
        Err(PlayerNameError::InvalidCharacters)
    );

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert_eq!(player.name, "Good_Name-7");
}

#[test]
fn player_can_spawn_with_prevalidated_display_name() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player_with_display_name(player_id, Some("Scout_7".to_string()))
        .expect("display name accepted");

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should be in snapshot");
    assert_eq!(player.name, "Scout_7");
}

#[test]
fn players_spawn_on_spread_walkable_plaza_slots() {
    let mut sim = SimWorld::new();
    let mut ids = Vec::new();
    for _ in 0..10 {
        let player_id = Uuid::new_v4();
        sim.add_player(player_id);
        ids.push(player_id);
    }

    let blockers = sim.movement_blockers();
    let positions = ids
        .iter()
        .map(|player_id| player_position(&sim, *player_id))
        .collect::<Vec<_>>();
    for position in &positions {
        assert!(
            sim.terrain.is_walkable_at_world(position.x, position.y),
            "spawned player should start on walkable terrain"
        );
        assert!(
            !blockers
                .iter()
                .any(|blocker| movement_blocker_contains_player(*blocker, *position)),
            "spawned player should not overlap blocking scenery"
        );
        assert!(
            distance(*position, sim.map.spawn) >= SPAWN_SLOT_BASE_RADIUS - 1.0,
            "spawned player should use a plaza slot instead of exact stacking"
        );
    }

    for first_index in 0..positions.len() {
        for second_index in first_index + 1..positions.len() {
            assert!(
                distance(positions[first_index], positions[second_index])
                    >= SPAWN_PLAYER_SEPARATION - 0.1,
                "spawn slots should separate nearby arrivals"
            );
        }
    }
}

#[test]
fn active_player_names_are_unique_case_insensitively() {
    let player_a = Uuid::new_v4();
    let player_b = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player_with_display_name(player_a, Some("Scout_7".to_string()))
        .expect("first player name accepted");

    assert_eq!(
        sim.add_player_with_display_name(player_b, Some("scout_7".to_string())),
        Err(PlayerNameError::Taken)
    );
    sim.add_player(player_b);
    assert_eq!(
        sim.rename_player(player_b, "SCOUT_7"),
        Err(PlayerNameError::Taken)
    );
    assert_eq!(
        sim.rename_player(player_a, "scout_7")
            .expect("own case-only rename accepted"),
        Some("scout_7".to_string())
    );
}

#[test]
fn removed_player_name_becomes_available() {
    let player_a = Uuid::new_v4();
    let player_b = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player_with_display_name(player_a, Some("Scout_7".to_string()))
        .expect("first player name accepted");

    sim.remove_player(player_a);

    sim.add_player_with_display_name(player_b, Some("scout_7".to_string()))
        .expect("removed player name should be reusable");
    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_b)
        .expect("second player should be in snapshot");
    assert_eq!(player.name, "scout_7");
}

#[test]
fn rename_player_updates_active_name_index() {
    let player_a = Uuid::new_v4();
    let player_b = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player_with_display_name(player_a, Some("Scout_7".to_string()))
        .expect("first player name accepted");
    sim.rename_player(player_a, "Ranger_7")
        .expect("rename should be valid");

    sim.add_player_with_display_name(player_b, Some("scout_7".to_string()))
        .expect("old name should be released after rename");
    assert_eq!(
        sim.rename_player(player_b, "RANGER_7"),
        Err(PlayerNameError::Taken)
    );
}
