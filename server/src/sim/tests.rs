use uuid::Uuid;

use super::*;
use crate::protocol::SettlementSnapshot;

mod crafting_inventory;
mod ecology_resources;
mod movement;
mod player_identity;
mod terrain_detail_authority;

fn empty_settlement() -> SettlementSnapshot {
    SettlementSnapshot {
        chain_enabled: false,
        pending_jobs: 0,
        confirmed_jobs: 0,
        owned_assets: 0,
        latest_receipt: None,
    }
}

fn assert_node_event(
    events: &[ResourceNodeChangedEvent],
    object_id: &str,
    resource: ResourceKind,
    amount: u32,
) {
    assert!(
        events.iter().any(|event| {
            event.object_id == object_id && event.resource == resource && event.amount == amount
        }),
        "expected node event for {object_id} {resource:?} amount {amount}; got {events:?}"
    );
}

#[test]
fn title_office_claim_updates_state_and_emits_one_settlement_job() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);

    sim.set_input(
        player_id,
        PlayerInput {
            right: true,
            ..PlayerInput::default()
        },
    );
    for _ in 0..5 {
        let outcome = sim.tick(0.05);
        assert!(outcome.settlement_jobs.is_empty());
        assert!(outcome.resource_events.is_empty());
    }
    move_player_to_object(&mut sim, player_id, "registrar", 8.0, 0.0);

    sim.set_input(
        player_id,
        PlayerInput {
            interact: true,
            ..PlayerInput::default()
        },
    );
    let outcome = sim.tick(0.05);
    let jobs = outcome.settlement_jobs;
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].player_id, player_id);
    assert!(jobs[0].asset_id.starts_with("dryrun-deed-"));
    assert!(outcome.resource_events.is_empty());

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert_eq!(player.demo_deeds, vec![jobs[0].asset_id.clone()]);

    let duplicate_outcome = sim.tick(0.05);
    assert!(duplicate_outcome.settlement_jobs.is_empty());
    assert!(duplicate_outcome.resource_events.is_empty());
}

#[test]
fn account_subject_flows_to_player_snapshot_and_settlement_job() {
    let player_id = Uuid::new_v4();
    let account_subject = "acct:wallet:0xabc123".to_string();
    let mut sim = SimWorld::new();
    sim.add_player_with_identity(
        player_id,
        Some("Acct_7".to_string()),
        Some(account_subject.clone()),
    )
    .expect("account-bound player should spawn");

    move_player_to_object(&mut sim, player_id, "registrar", 8.0, 0.0);
    sim.set_input(
        player_id,
        PlayerInput {
            interact: true,
            ..PlayerInput::default()
        },
    );

    let outcome = sim.tick(0.05);
    assert_eq!(outcome.settlement_jobs.len(), 1);
    assert_eq!(
        outcome.settlement_jobs[0].account_subject.as_deref(),
        Some(account_subject.as_str())
    );

    let snapshot = sim.snapshot(empty_settlement());
    let player = snapshot
        .players
        .iter()
        .find(|player| player.id == player_id)
        .expect("player should remain in snapshot");
    assert_eq!(
        player.account_subject.as_deref(),
        Some(account_subject.as_str())
    );
}

#[test]
fn interaction_far_from_objects_does_not_mutate_resources_or_settlement() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    let entity = sim.players.get(&player_id).copied().expect("player exists");
    let mut position = sim
        .world
        .get_mut::<Position>(entity)
        .expect("player position");
    position.x = 40.0;
    position.y = 40.0;

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
    assert_eq!(player.demo_deeds.len(), 0);
    assert_eq!(player.resources.wood, 0);
    assert_eq!(player.resources.ore, 0);
}

#[test]
fn object_positions_are_indexed_by_content_id() {
    let sim = SimWorld::new();
    let registrar_position = sim
        .object_position("registrar")
        .expect("registrar should be indexed");
    assert_eq!(registrar_position.x, 3072.0);
    assert_eq!(registrar_position.y, 1984.0);
    assert!(sim.object_position("missing-object").is_none());
}

fn player_position(sim: &SimWorld, player_id: PlayerId) -> Position {
    let entity = sim.players.get(&player_id).copied().expect("player exists");
    *sim.world
        .get::<Position>(entity)
        .expect("player has position")
}

fn move_player_to_object(
    sim: &mut SimWorld,
    player_id: PlayerId,
    object_id: &str,
    dx: f32,
    dy: f32,
) {
    let object_position = sim.object_position(object_id).expect("object exists");
    let entity = sim.players.get(&player_id).copied().expect("player exists");
    let mut position = sim
        .world
        .get_mut::<Position>(entity)
        .expect("player position");
    position.x = object_position.x + dx;
    position.y = object_position.y + dy;
    sim.player_index.insert_or_update(
        entity,
        Point {
            x: position.x,
            y: position.y,
        },
    );
}

fn move_player_to_position(sim: &mut SimWorld, player_id: PlayerId, target: Position) {
    let entity = sim.players.get(&player_id).copied().expect("player exists");
    let mut position = sim
        .world
        .get_mut::<Position>(entity)
        .expect("player position");
    position.x = target.x;
    position.y = target.y;
    sim.player_index.insert_or_update(
        entity,
        Point {
            x: position.x,
            y: position.y,
        },
    );
}
