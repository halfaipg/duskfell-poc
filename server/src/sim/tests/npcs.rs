use super::*;

#[test]
fn nearest_npc_is_selected_and_canned_speech_rotates() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    let maren_position = sim
        .npcs
        .get("maren")
        .expect("Maren fixture exists")
        .position;
    move_player_to_position(&mut sim, player_id, maren_position);

    let target = sim
        .nearest_npc_for_player(player_id)
        .expect("demo spawn is close to an NPC");
    assert_eq!(target.id, "maren");

    assert!(sim.apply_npc_canned_intent(&target.id, player_id).is_ok());
    let first = sim
        .snapshot(empty_settlement())
        .npcs
        .into_iter()
        .find(|npc| npc.id == target.id)
        .and_then(|npc| npc.speech)
        .expect("fallback speech appears in snapshots")
        .text;

    assert!(sim.apply_npc_canned_intent(&target.id, player_id).is_ok());
    let second = sim
        .snapshot(empty_settlement())
        .npcs
        .into_iter()
        .find(|npc| npc.id == target.id)
        .and_then(|npc| npc.speech)
        .expect("second fallback appears in snapshots")
        .text;
    assert_ne!(first, second);
}

#[test]
fn npc_speech_is_sanitized_and_bounded() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    let maren_position = sim.npcs.get("maren").expect("Maren exists").position;
    move_player_to_position(&mut sim, player_id, maren_position);
    let long = format!("  hello\n{}  ", "x".repeat(200));
    let applied = sim
        .apply_actor_intent(
            ActorId::Npc("maren".to_string()),
            ActorIntent::Say {
                text: long,
                audience: Some(player_id),
            },
        )
        .expect("nearby NPC speech should be accepted");
    assert!(!applied.clean_text.contains('\n'));
    assert!(applied.clean_text.chars().count() <= 128);

    let speech = sim
        .snapshot(empty_settlement())
        .npcs
        .into_iter()
        .find(|npc| npc.id == "maren")
        .and_then(|npc| npc.speech)
        .expect("speech appears");
    assert!(!speech.text.contains('\n'));
    assert!(speech.text.chars().count() <= 128);
}

#[test]
fn players_and_npcs_share_the_actor_intent_boundary() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    let maren_position = sim.npcs.get("maren").expect("Maren exists").position;
    move_player_to_position(&mut sim, player_id, maren_position);

    let player_speech = sim
        .apply_actor_intent(
            ActorId::Player(player_id),
            ActorIntent::Say {
                text: "  Hello\nMaren  ".to_string(),
                audience: None,
            },
        )
        .expect("player intent should be accepted");
    assert_eq!(player_speech.clean_text, "HelloMaren");
    assert_eq!(
        player_speech.nearby_npc.as_ref().map(|npc| npc.id.as_str()),
        Some("maren")
    );

    let npc_speech = sim
        .apply_actor_intent(
            ActorId::Npc("maren".to_string()),
            ActorIntent::Say {
                text: "Keep to the lit road.".to_string(),
                audience: Some(player_id),
            },
        )
        .expect("NPC intent should pass the same boundary");
    assert_eq!(npc_speech.clean_text, "Keep to the lit road.");
    assert!(npc_speech.nearby_npc.is_none());
}

#[test]
fn delayed_npc_intent_is_rejected_after_player_leaves_range() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    let maren_position = sim.npcs.get("maren").expect("Maren exists").position;
    move_player_to_position(
        &mut sim,
        player_id,
        Position {
            x: maren_position.x + 1_000.0,
            y: maren_position.y,
        },
    );

    let result = sim.apply_actor_intent(
        ActorId::Npc("maren".to_string()),
        ActorIntent::Say {
            text: "You are already gone.".to_string(),
            audience: Some(player_id),
        },
    );

    assert_eq!(result, Err(ActorIntentError::AudienceOutOfRange));
}

#[test]
fn npc_intent_rejects_unknown_actor_and_audience() {
    let player_id = Uuid::new_v4();
    let mut sim = SimWorld::new();
    sim.add_player(player_id);
    let maren_position = sim.npcs.get("maren").expect("Maren exists").position;
    move_player_to_position(&mut sim, player_id, maren_position);

    assert_eq!(
        sim.apply_actor_intent(
            ActorId::Npc("missing".to_string()),
            ActorIntent::Say {
                text: "No.".to_string(),
                audience: Some(player_id),
            },
        ),
        Err(ActorIntentError::UnknownActor)
    );
    assert_eq!(
        sim.apply_actor_intent(
            ActorId::Npc("maren".to_string()),
            ActorIntent::Say {
                text: "No.".to_string(),
                audience: Some(Uuid::new_v4()),
            },
        ),
        Err(ActorIntentError::InvalidAudience)
    );
}
