use super::*;
use crate::terrain::TerrainMaterial;
use uuid::Uuid;

#[test]
fn diagonal_movement_is_not_faster_than_cardinal_movement() {
    let cardinal_player = Uuid::new_v4();
    let diagonal_player = Uuid::new_v4();

    let mut cardinal = SimWorld::new();
    cardinal.add_player(cardinal_player);
    move_player_to_position(
        &mut cardinal,
        cardinal_player,
        Position {
            x: 1000.0,
            y: 700.0,
        },
    );
    cardinal.set_input(
        cardinal_player,
        PlayerInput {
            right: true,
            ..PlayerInput::default()
        },
    );
    let cardinal_start = player_position(&cardinal, cardinal_player);
    cardinal.tick(1.0);
    let cardinal_end = player_position(&cardinal, cardinal_player);

    let mut diagonal = SimWorld::new();
    diagonal.add_player(diagonal_player);
    move_player_to_position(
        &mut diagonal,
        diagonal_player,
        Position {
            x: 1000.0,
            y: 700.0,
        },
    );
    diagonal.set_input(
        diagonal_player,
        PlayerInput {
            right: true,
            down: true,
            ..PlayerInput::default()
        },
    );
    let diagonal_start = player_position(&diagonal, diagonal_player);
    diagonal.tick(1.0);
    let diagonal_end = player_position(&diagonal, diagonal_player);

    assert!((travel_distance(cardinal_start, cardinal_end) - PLAYER_SPEED).abs() < 0.01);
    assert!((travel_distance(diagonal_start, diagonal_end) - PLAYER_SPEED).abs() < 0.01);
}

#[test]
fn world_objects_block_authoritative_movement() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    let registrar = sim.object_position("registrar").expect("registrar exists");
    let registrar_radius = object_solid_radius(54.0);
    let start = Position {
        x: registrar.x - registrar_radius - PLAYER_COLLISION_RADIUS - 6.0,
        y: registrar.y,
    };
    move_player_to_position(&mut sim, player_id, start);

    sim.set_input(
        player_id,
        PlayerInput {
            right: true,
            ..PlayerInput::default()
        },
    );
    sim.tick(0.1);
    let after = player_position(&sim, player_id);

    assert!((after.x - start.x).abs() < 0.01);
    assert!((after.y - start.y).abs() < 0.01);
}

#[test]
fn overlapped_world_object_allows_movement_away() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    let registrar = sim.object_position("registrar").expect("registrar exists");
    let start = Position {
        x: registrar.x - 10.0,
        y: registrar.y,
    };
    move_player_to_position(&mut sim, player_id, start);

    sim.set_input(
        player_id,
        PlayerInput {
            left: true,
            ..PlayerInput::default()
        },
    );
    sim.tick(0.1);
    let after = player_position(&sim, player_id);

    assert!(after.x < start.x - 1.0);
    assert!((after.y - start.y).abs() < 0.01);
}

#[test]
fn terrain_detail_authority_blocks_authoritative_movement() {
    let player_id = Uuid::new_v4();
    let authority = test_terrain_detail_authority(TerrainDetailAuthorityBlocker {
        id: "test-tree-blocker".to_string(),
        x: 1000.0,
        y: 700.0,
        collision: TerrainDetailAuthorityCollision {
            blocks_movement: true,
            shape: "aabb".to_string(),
            width_tiles: 1.0,
            height_tiles: 1.0,
        },
    });
    let mut sim =
        SimWorld::from_content_with_terrain_detail_authority(WorldContent::demo(), Some(authority))
            .expect("test terrain detail authority should load");
    sim.add_player(player_id);
    let start = Position {
        x: 1000.0 + 32.0 + PLAYER_COLLISION_RADIUS + 4.0,
        y: 700.0,
    };
    move_player_to_position(&mut sim, player_id, start);

    sim.set_input(
        player_id,
        PlayerInput {
            left: true,
            ..PlayerInput::default()
        },
    );
    sim.tick(0.1);
    let after = player_position(&sim, player_id);

    assert!((after.x - start.x).abs() < 0.01);
    assert!((after.y - start.y).abs() < 0.01);
}

#[test]
fn overlapped_terrain_detail_authority_allows_movement_away() {
    let player_id = Uuid::new_v4();
    let authority = test_terrain_detail_authority(TerrainDetailAuthorityBlocker {
        id: "test-tree-blocker".to_string(),
        x: 1000.0,
        y: 700.0,
        collision: TerrainDetailAuthorityCollision {
            blocks_movement: true,
            shape: "aabb".to_string(),
            width_tiles: 1.0,
            height_tiles: 1.0,
        },
    });
    let mut sim =
        SimWorld::from_content_with_terrain_detail_authority(WorldContent::demo(), Some(authority))
            .expect("test terrain detail authority should load");
    sim.add_player(player_id);
    let start = Position { x: 988.0, y: 700.0 };
    move_player_to_position(&mut sim, player_id, start);

    sim.set_input(
        player_id,
        PlayerInput {
            left: true,
            ..PlayerInput::default()
        },
    );
    sim.tick(0.1);
    let after = player_position(&sim, player_id);

    assert!(after.x < start.x - 1.0);
    assert!((after.y - start.y).abs() < 0.01);
}

#[test]
fn terrain_water_blocks_authoritative_movement() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    let (from, blocked_target) = water_blocking_route(&sim);
    move_player_to_position(&mut sim, player_id, from);

    sim.set_input(
        player_id,
        PlayerInput {
            right: true,
            ..PlayerInput::default()
        },
    );
    sim.tick((blocked_target.x - from.x) / PLAYER_SPEED);
    let after = player_position(&sim, player_id);

    assert_eq!(
        sim.terrain
            .material_at_world(blocked_target.x, blocked_target.y),
        TerrainMaterial::Water
    );
    assert!(after.x < blocked_target.x - 1.0);
    assert!((after.y - from.y).abs() < 0.01);
}

fn water_blocking_route(sim: &SimWorld) -> (Position, Position) {
    for y in (64..(sim.map.height as i32 - 64)).step_by(16) {
        for x in (64..(sim.map.width as i32 - 256)).step_by(16) {
            let from = Position {
                x: x as f32,
                y: y as f32,
            };
            let to = Position {
                x: x as f32 + PLAYER_SPEED,
                y: y as f32,
            };
            if sim.terrain.is_walkable_at_world(from.x, from.y)
                && sim.terrain.material_at_world(to.x, to.y) == TerrainMaterial::Water
                && !sim.terrain.allows_step(from.x, from.y, to.x, to.y)
            {
                return (from, to);
            }
        }
    }
    panic!("expected demo terrain to include a horizontal walkable-to-water route");
}

fn test_terrain_detail_authority(blocker: TerrainDetailAuthorityBlocker) -> TerrainDetailAuthority {
    TerrainDetailAuthority {
        schema_version: "duskfell-terrain-detail-authority-v1".to_string(),
        projection: "military-plan-oblique".to_string(),
        profile: "duskfell-terrain-v1".to_string(),
        units_per_tile: 64,
        blockers: vec![blocker],
        resource_nodes: Vec::new(),
        decay_consumers: Vec::new(),
    }
}

fn travel_distance(start: Position, end: Position) -> f32 {
    ((end.x - start.x).powi(2) + (end.y - start.y).powi(2)).sqrt()
}
