use super::*;
use crate::sim::model::{FOLLOW_DISTANCE, TALK_RADIUS};
use crate::sim::npcs::NpcPartyError;
use uuid::Uuid;

fn npc_position(sim: &SimWorld, npc_id: &str) -> Position {
    let entity = sim
        .npc_entities
        .get(npc_id)
        .copied()
        .expect("npc exists in index");
    *sim.world.get::<Position>(entity).expect("npc has position")
}

fn separation(sim: &SimWorld, player_id: PlayerId, npc_id: &str) -> f32 {
    let player = player_position(sim, player_id);
    let npc = npc_position(sim, npc_id);
    ((player.x - npc.x).powi(2) + (player.y - npc.y).powi(2)).sqrt()
}

fn stand_next_to_npc(sim: &mut SimWorld, player_id: PlayerId, npc_id: &str) {
    let npc = npc_position(sim, npc_id);
    move_player_to_position(
        sim,
        player_id,
        Position {
            x: npc.x + 30.0,
            y: npc.y,
        },
    );
}

#[test]
fn npcs_spawn_from_world_content_and_appear_in_snapshots() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);

    let snapshot = sim.snapshot_for_player(player_id, empty_settlement(), INTEREST_RADIUS);
    let ids: Vec<&str> = snapshot.npcs.iter().map(|npc| npc.id.as_str()).collect();
    assert_eq!(ids, vec!["bram", "maren"], "sorted by id, both in range");
    let maren = &snapshot.npcs[1];
    assert_eq!(maren.name, "Maren");
    assert!(maren.party_player_id.is_none());
}

#[test]
fn npcs_outside_interest_radius_are_filtered() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    move_player_to_position(&mut sim, player_id, Position { x: 640.0, y: 520.0 });

    let snapshot = sim.snapshot_for_player(player_id, empty_settlement(), INTEREST_RADIUS);
    assert!(
        snapshot.npcs.is_empty(),
        "npcs near the settlement should be out of interest range from the grove"
    );
}

#[test]
fn party_invite_requires_talk_range() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);

    let gap = separation(&sim, player_id, "bram");
    assert!(
        gap > TALK_RADIUS,
        "spawn should be out of bram's talk range"
    );
    let err = sim
        .invite_npc_to_party(player_id, "bram")
        .expect_err("out of range invite must fail");
    assert_eq!(err, NpcPartyError::OutOfRange);

    let err = sim
        .invite_npc_to_party(player_id, "nobody")
        .expect_err("unknown npc must fail");
    assert_eq!(err, NpcPartyError::UnknownNpc);
}

#[test]
fn party_invite_auto_accepts_and_npc_follows_leader() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    stand_next_to_npc(&mut sim, player_id, "maren");

    sim.invite_npc_to_party(player_id, "maren")
        .expect("in-range invite succeeds");
    let outcome = sim.tick(0.05);
    assert!(
        outcome.npc_party_events.iter().any(|event| matches!(
            event,
            NpcPartyEvent::Joined { player_id: p, npc_id } if *p == player_id && npc_id == "maren"
        )),
        "invite should auto-accept on the next tick"
    );
    assert_eq!(sim.npc_party_leader("maren"), Some(player_id));

    // Walk the leader west; the NPC should close the gap to follow distance.
    move_player_to_position(
        &mut sim,
        player_id,
        Position {
            x: 2800.0,
            y: 2060.0,
        },
    );
    let start_gap = separation(&sim, player_id, "maren");
    assert!(start_gap > FOLLOW_DISTANCE);
    for _ in 0..40 {
        sim.tick(0.05);
    }
    let end_gap = separation(&sim, player_id, "maren");
    assert!(
        end_gap < start_gap && end_gap <= FOLLOW_DISTANCE + 12.0,
        "npc should follow to within follow distance: start {start_gap}, end {end_gap}"
    );
}

#[test]
fn lagging_party_npcs_catch_up_by_teleporting_to_the_leader() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    stand_next_to_npc(&mut sim, player_id, "maren");
    sim.invite_npc_to_party(player_id, "maren")
        .expect("invite succeeds");
    sim.tick(0.05);
    assert_eq!(sim.npc_party_leader("maren"), Some(player_id));

    // Leader ends up far beyond catch-up range (stuck follower scenario).
    move_player_to_position(
        &mut sim,
        player_id,
        Position {
            x: 2500.0,
            y: 2048.0,
        },
    );
    let outcome = sim.tick(0.05);
    assert!(
        outcome
            .npc_relocation_events
            .iter()
            .any(|event| event.npc_id == "maren"),
        "catch-up teleport should be journaled as a relocation"
    );
    let gap = separation(&sim, player_id, "maren");
    assert!(
        gap <= 60.0,
        "npc should blink to the leader's side, gap was {gap}"
    );
    // And the spatial index followed, so she stays in the leader's view.
    let npc_entity = sim.npc_entities.get("maren").copied().expect("npc exists");
    let npc = npc_position(&sim, "maren");
    assert!(sim
        .npc_index
        .query_radius(Point { x: npc.x, y: npc.y }, 30.0)
        .contains(&npc_entity));
}

#[test]
fn party_rules_enforce_one_party_per_player_and_npc() {
    let leader = Uuid::new_v4();
    let rival = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(leader);
    sim.add_player(rival);
    stand_next_to_npc(&mut sim, leader, "maren");
    sim.invite_npc_to_party(leader, "maren")
        .expect("first invite succeeds");
    sim.tick(0.05);

    stand_next_to_npc(&mut sim, rival, "maren");
    let err = sim
        .invite_npc_to_party(rival, "maren")
        .expect_err("npc already in a party");
    assert_eq!(err, NpcPartyError::NpcBusy);

    stand_next_to_npc(&mut sim, leader, "bram");
    let err = sim
        .invite_npc_to_party(leader, "bram")
        .expect_err("player already leads a party");
    assert_eq!(err, NpcPartyError::PlayerBusy);
}

#[test]
fn leaving_party_stops_follow_and_frees_both_sides() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    stand_next_to_npc(&mut sim, player_id, "maren");
    sim.invite_npc_to_party(player_id, "maren")
        .expect("invite succeeds");
    sim.tick(0.05);
    assert_eq!(sim.npc_party_leader("maren"), Some(player_id));

    let err = sim
        .leave_npc_party(player_id, "bram")
        .expect_err("not partied with bram");
    assert_eq!(err, NpcPartyError::NotInParty);

    sim.leave_npc_party(player_id, "maren")
        .expect("leader can dissolve the party");
    assert_eq!(sim.npc_party_leader("maren"), None);

    let before = npc_position(&sim, "maren");
    for _ in 0..10 {
        sim.tick(0.05);
    }
    let after = npc_position(&sim, "maren");
    assert_eq!(
        (before.x, before.y),
        (after.x, after.y),
        "npc should stand still after the party dissolves"
    );

    // Both sides are free again.
    stand_next_to_npc(&mut sim, player_id, "maren");
    sim.invite_npc_to_party(player_id, "maren")
        .expect("npc can be invited again");
}

#[test]
fn engine_owned_invites_decline_after_the_decision_timeout() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    sim.set_npc_invites_deterministic(false);
    stand_next_to_npc(&mut sim, player_id, "maren");
    sim.invite_npc_to_party(player_id, "maren")
        .expect("invite succeeds");

    // Well before the timeout: still pending, never auto-accepted.
    let outcome = sim.tick(0.05);
    assert!(outcome.npc_party_events.is_empty());
    assert!(sim.pending_npc_invite("maren").is_some());

    // Jump past the decision timeout: the invite declines.
    sim.tick += 60 * 20;
    let outcome = sim.tick(0.05);
    assert!(
        outcome.npc_party_events.iter().any(|event| matches!(
            event,
            NpcPartyEvent::Declined { npc_id, .. } if npc_id == "maren"
        )),
        "unresolved engine-owned invites must decline, got {:?}",
        outcome.npc_party_events
    );
    assert!(sim.pending_npc_invite("maren").is_none());
    // The NPC is free again.
    stand_next_to_npc(&mut sim, player_id, "maren");
    sim.invite_npc_to_party(player_id, "maren")
        .expect("npc can be invited again after expiry");
}

#[test]
fn disconnecting_player_dissolves_their_party() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    stand_next_to_npc(&mut sim, player_id, "maren");
    sim.invite_npc_to_party(player_id, "maren")
        .expect("invite succeeds");
    sim.tick(0.05);
    assert_eq!(sim.npc_party_leader("maren"), Some(player_id));

    sim.remove_player(player_id);
    assert_eq!(sim.npc_party_leader("maren"), None);
}

#[test]
fn scheduled_relocation_fires_on_world_day_offset() {
    let mut sim = SimWorld::new();
    // Default day is 600s; bram's second entry is at 300s => tick 6000.
    sim.tick = 5_999;
    let outcome = sim.tick(0.05);
    let event = outcome
        .npc_relocation_events
        .iter()
        .find(|event| event.npc_id == "bram")
        .expect("bram relocates at his scheduled world time");
    assert_eq!((event.x, event.y), (2980.0, 2120.0));
    let position = npc_position(&sim, "bram");
    assert_eq!((position.x, position.y), (2980.0, 2120.0));

    // The spatial index followed the teleport.
    let hits = sim.npc_index.query_radius(
        Point {
            x: 2980.0,
            y: 2120.0,
        },
        30.0,
    );
    assert_eq!(hits.len(), 1);
}

#[test]
fn npcs_in_a_party_skip_scheduled_relocation() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    stand_next_to_npc(&mut sim, player_id, "bram");
    sim.invite_npc_to_party(player_id, "bram")
        .expect("invite succeeds");
    sim.tick(0.05);
    assert_eq!(sim.npc_party_leader("bram"), Some(player_id));

    sim.tick = 5_999;
    let outcome = sim.tick(0.05);
    assert!(
        outcome
            .npc_relocation_events
            .iter()
            .all(|event| event.npc_id != "bram"),
        "partied npcs stay with their leader instead of teleporting"
    );
}

#[test]
fn moving_npcs_stay_out_of_the_player_spatial_index() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    stand_next_to_npc(&mut sim, player_id, "maren");
    sim.invite_npc_to_party(player_id, "maren")
        .expect("invite succeeds");
    sim.tick(0.05);
    move_player_to_position(
        &mut sim,
        player_id,
        Position {
            x: 2800.0,
            y: 2060.0,
        },
    );
    for _ in 0..10 {
        sim.tick(0.05);
    }

    let npc = npc_position(&sim, "maren");
    let npc_entity = sim.npc_entities.get("maren").copied().expect("npc exists");
    let players_near_npc = sim
        .player_index
        .query_radius(Point { x: npc.x, y: npc.y }, 5.0);
    assert!(
        !players_near_npc.contains(&npc_entity),
        "npc entities must never enter the player spatial index"
    );
    let npcs_near_npc = sim
        .npc_index
        .query_radius(Point { x: npc.x, y: npc.y }, 5.0);
    assert!(npcs_near_npc.contains(&npc_entity));
}
