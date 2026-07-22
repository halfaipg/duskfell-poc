use std::collections::BTreeMap;
use std::time::Duration;

use animus::{
    Engine, EngineConfig, EngineOutput, EngineStatus, FallbackTrigger, GameEvent, NpcBinding,
    ParamSpec, PersonaRegistration, ProviderConfig, VerbSpec, WorldRegistration,
};

fn world() -> WorldRegistration {
    WorldRegistration {
        world_id: "test-world".to_string(),
        verbs: vec![
            VerbSpec {
                name: "say".to_string(),
                params: vec![
                    ParamSpec {
                        name: "targetId".to_string(),
                        required: false,
                    },
                    ParamSpec {
                        name: "text".to_string(),
                        required: true,
                    },
                ],
            },
            VerbSpec {
                name: "acceptParty".to_string(),
                params: vec![ParamSpec {
                    name: "inviteId".to_string(),
                    required: true,
                }],
            },
            VerbSpec {
                name: "declineParty".to_string(),
                params: vec![
                    ParamSpec {
                        name: "inviteId".to_string(),
                        required: true,
                    },
                    ParamSpec {
                        name: "text".to_string(),
                        required: false,
                    },
                ],
            },
        ],
        lore: "A test world.".to_string(),
        place_glossary: BTreeMap::new(),
        npcs: vec![
            NpcBinding {
                npc_id: "clerk".to_string(),
                persona_id: "clerk".to_string(),
            },
            NpcBinding {
                npc_id: "smith".to_string(),
                persona_id: "smith".to_string(),
            },
        ],
    }
}

fn personas() -> Vec<PersonaRegistration> {
    vec![
        PersonaRegistration {
            id: "clerk".to_string(),
            name: "Clerk".to_string(),
            role: "registrar".to_string(),
            persona: "Precise.".to_string(),
            drives: vec![],
            home_place: None,
            party_policy: Some("reluctant".to_string()),
            greets_players: false,
            canned: vec!["Mm.".to_string()],
        },
        PersonaRegistration {
            id: "smith".to_string(),
            name: "Smith".to_string(),
            role: "smith".to_string(),
            persona: "Gruff.".to_string(),
            drives: vec![],
            home_place: None,
            party_policy: Some("eager".to_string()),
            greets_players: false,
            canned: vec!["Hot forge.".to_string()],
        },
    ]
}

fn mock_config() -> EngineConfig {
    EngineConfig {
        provider: ProviderConfig::Mock,
        ..EngineConfig::default()
    }
}

async fn next_non_status(outputs: &mut tokio::sync::mpsc::Receiver<EngineOutput>) -> EngineOutput {
    loop {
        let output = tokio::time::timeout(Duration::from_secs(2), outputs.recv())
            .await
            .expect("engine output within deadline")
            .expect("engine output channel open");
        if !matches!(output, EngineOutput::StatusChanged { .. }) {
            return output;
        }
    }
}

#[tokio::test]
async fn speech_produces_validated_say_intent_with_transcript_flow() {
    let mut handle = Engine::spawn(mock_config(), world(), personas());

    handle
        .events
        .send(GameEvent::ActorSpoke {
            npc_id: "clerk".to_string(),
            actor_id: "p1".to_string(),
            actor_name: "Wayfarer".to_string(),
            text: "hello".to_string(),
        })
        .await
        .expect("event accepted");

    let first = next_non_status(&mut handle.outputs).await;
    let EngineOutput::Intent {
        verb,
        params,
        npc_id,
        ..
    } = first
    else {
        panic!("expected intent, got {first:?}");
    };
    assert_eq!(verb, "say");
    assert_eq!(npc_id, "clerk");
    assert_eq!(params["targetId"], "p1");
    let first_text = params["text"].as_str().expect("say text").to_string();
    assert!(first_text.contains("hello"));

    // Second turn: the transcript should have grown (player line + npc reply
    // + this player line = turn 3 by the time the mock sees it).
    handle
        .events
        .send(GameEvent::ActorSpoke {
            npc_id: "clerk".to_string(),
            actor_id: "p1".to_string(),
            actor_name: "Wayfarer".to_string(),
            text: "who owns the field?".to_string(),
        })
        .await
        .expect("event accepted");
    let second = next_non_status(&mut handle.outputs).await;
    let EngineOutput::Intent { params, .. } = second else {
        panic!("expected second intent");
    };
    let second_text = params["text"].as_str().expect("say text");
    assert!(
        second_text.contains("turn 3"),
        "transcript feeds cognition: {second_text}"
    );
}

#[tokio::test]
async fn transcripts_are_isolated_per_npc_and_actor() {
    let mut handle = Engine::spawn(mock_config(), world(), personas());

    for (actor_id, text) in [("p1", "private one"), ("p2", "private two")] {
        handle
            .events
            .send(GameEvent::ActorSpoke {
                npc_id: "clerk".to_string(),
                actor_id: actor_id.to_string(),
                actor_name: actor_id.to_string(),
                text: text.to_string(),
            })
            .await
            .expect("event accepted");
        let EngineOutput::Intent { params, .. } = next_non_status(&mut handle.outputs).await else {
            panic!("expected say intent");
        };
        let reply = params["text"].as_str().expect("say text");
        assert!(
            reply.contains("turn 1"),
            "new actor starts a private transcript: {reply}"
        );
        assert!(reply.contains(text));
    }
}

#[tokio::test]
async fn party_invites_follow_persona_policy() {
    let mut handle = Engine::spawn(mock_config(), world(), personas());

    handle
        .events
        .send(GameEvent::PartyInvite {
            npc_id: "clerk".to_string(),
            invite_id: "inv-1".to_string(),
            actor_id: "p1".to_string(),
            actor_name: "Wayfarer".to_string(),
        })
        .await
        .expect("event accepted");
    let output = next_non_status(&mut handle.outputs).await;
    let EngineOutput::Intent { verb, params, .. } = output else {
        panic!("expected intent, got {output:?}");
    };
    assert_eq!(verb, "declineParty", "reluctant persona declines");
    assert_eq!(params["inviteId"], "inv-1");

    handle
        .events
        .send(GameEvent::PartyInvite {
            npc_id: "smith".to_string(),
            invite_id: "inv-2".to_string(),
            actor_id: "p1".to_string(),
            actor_name: "Wayfarer".to_string(),
        })
        .await
        .expect("event accepted");
    let output = next_non_status(&mut handle.outputs).await;
    let EngineOutput::Intent { verb, params, .. } = output else {
        panic!("expected intent, got {output:?}");
    };
    assert_eq!(verb, "acceptParty", "eager persona accepts");
    assert_eq!(params["inviteId"], "inv-2");
}

#[tokio::test]
async fn exhausted_request_budget_falls_back_instead_of_calling_provider() {
    let config = EngineConfig {
        provider: ProviderConfig::Mock,
        requests_per_minute: 1,
        ..EngineConfig::default()
    };
    let mut handle = Engine::spawn(config, world(), personas());

    for text in ["one", "two"] {
        handle
            .events
            .send(GameEvent::ActorSpoke {
                npc_id: "clerk".to_string(),
                actor_id: "p1".to_string(),
                actor_name: "Wayfarer".to_string(),
                text: text.to_string(),
            })
            .await
            .expect("event accepted");
    }

    let first = next_non_status(&mut handle.outputs).await;
    assert!(matches!(first, EngineOutput::Intent { .. }));
    let second = next_non_status(&mut handle.outputs).await;
    let EngineOutput::Fallback { trigger, .. } = second else {
        panic!("expected fallback after budget exhaustion, got {second:?}");
    };
    assert!(matches!(trigger, FallbackTrigger::Speech { actor_id } if actor_id == "p1"));
    assert_eq!(handle.metrics.snapshot().fallbacks_total, 1);
}

#[tokio::test]
async fn initial_status_is_reported() {
    let mut handle = Engine::spawn(mock_config(), world(), personas());
    let output = tokio::time::timeout(Duration::from_secs(2), handle.outputs.recv())
        .await
        .expect("status within deadline")
        .expect("channel open");
    let EngineOutput::StatusChanged { status } = output else {
        panic!("expected initial status, got {output:?}");
    };
    assert_eq!(status, EngineStatus::MockOnly);
}

#[tokio::test]
async fn ungreeting_personas_never_answer_lingering() {
    let mut handle = Engine::spawn(mock_config(), world(), personas());
    handle
        .events
        .send(GameEvent::ActorLingered {
            npc_id: "clerk".to_string(),
            actor_id: "p1".to_string(),
            actor_name: "Wayfarer".to_string(),
        })
        .await
        .expect("event accepted");
    // Follow with speech; the only non-status output must be the say intent.
    handle
        .events
        .send(GameEvent::ActorSpoke {
            npc_id: "clerk".to_string(),
            actor_id: "p1".to_string(),
            actor_name: "Wayfarer".to_string(),
            text: "hi".to_string(),
        })
        .await
        .expect("event accepted");
    let output = next_non_status(&mut handle.outputs).await;
    let EngineOutput::Intent { verb, .. } = output else {
        panic!("expected say intent, got {output:?}");
    };
    assert_eq!(verb, "say");
}
