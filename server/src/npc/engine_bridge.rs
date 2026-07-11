use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::Duration;

use anyhow::anyhow;
use tokio::sync::{mpsc, Mutex};

use animus::{
    Engine, EngineConfig, EngineHandle, EngineMetrics, EngineOutput, EngineStatus, GameEvent,
    NpcBinding, ParamSpec, PersonaRegistration, ProviderConfig, VerbSpec, WorldRegistration,
};

use crate::config::{
    env_bool, env_optional_nonempty_string, env_positive_u32, env_positive_u64, env_positive_usize,
};
use crate::content::{PersonaContent, WorldContent};

pub const DEFAULT_ANIMUS_BASE_URL: &str = "https://api.aipowergrid.io";
const DEFAULT_LORE: &str = "Duskfell is a hard-scrabble frontier settlement rebuilding after a \
    collapse. Land claims run through the Title Office ledger; the Field Forge turns gathered \
    wood and ore into tools. Wayfarers drift in from the wilds looking for a claim of their own.";

/// The game's handle to the cognition engine, shared through AppState.
#[derive(Clone)]
pub struct EngineBridge {
    pub events: mpsc::Sender<GameEvent>,
    pub metrics: Arc<EngineMetrics>,
    pub status: Arc<Mutex<EngineStatus>>,
}

/// Reads the ANIMUS_* config surface and spawns the engine when a provider is
/// available. Returns None when the engine is disabled or (in `auto` mode) no
/// API key is configured — the game then stays fully deterministic with
/// canned dialogue, which is the documented zero-config path.
pub fn maybe_spawn_engine(
    content: &WorldContent,
    personas: &HashMap<String, PersonaContent>,
) -> anyhow::Result<Option<(EngineBridge, mpsc::Receiver<EngineOutput>)>> {
    if !env_bool("ANIMUS_ENABLED", true)? {
        return Ok(None);
    }
    let provider_mode = std::env::var("ANIMUS_PROVIDER").unwrap_or_else(|_| "auto".to_string());
    let api_key = env_optional_nonempty_string("ANIMUS_API_KEY")?;
    let base_url = std::env::var("ANIMUS_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_ANIMUS_BASE_URL.to_string());
    let model = env_optional_nonempty_string("ANIMUS_MODEL")?;

    let provider = match provider_mode.as_str() {
        "mock" => ProviderConfig::Mock,
        "auto" => match api_key {
            Some(api_key) => ProviderConfig::OpenAiCompatible {
                base_url,
                api_key,
                model,
            },
            None => return Ok(None),
        },
        "openai-compatible" => {
            let api_key = api_key.ok_or_else(|| {
                anyhow!("ANIMUS_PROVIDER=openai-compatible requires ANIMUS_API_KEY")
            })?;
            ProviderConfig::OpenAiCompatible {
                base_url,
                api_key,
                model,
            }
        }
        other => {
            return Err(anyhow!(
                "ANIMUS_PROVIDER must be auto, mock, or openai-compatible; got '{other}'"
            ))
        }
    };

    let config = EngineConfig {
        provider,
        max_concurrent_jobs: env_positive_usize("ANIMUS_MAX_CONCURRENT_JOBS", 2)?,
        queue_capacity: env_positive_usize("ANIMUS_QUEUE_CAPACITY", 32)?,
        requests_per_minute: env_positive_u32("ANIMUS_REQUESTS_PER_MINUTE", 20)?,
        interactive_timeout: Duration::from_millis(env_positive_u64(
            "ANIMUS_INTERACTIVE_TIMEOUT_MS",
            15_000,
        )?),
        max_reply_tokens: env_positive_u32("ANIMUS_MAX_REPLY_TOKENS", 256)?,
    };

    let world = world_registration(content);
    let personas = persona_registrations(personas);
    let EngineHandle {
        events,
        outputs,
        metrics,
    } = Engine::spawn(config, world, personas);

    let bridge = EngineBridge {
        events,
        metrics,
        status: Arc::new(Mutex::new(EngineStatus::Degraded {
            reason: "starting".to_string(),
        })),
    };
    Ok(Some((bridge, outputs)))
}

/// The game's vocabulary (design §3.1): dialogue and small social decisions
/// only — no movement verbs in v1.
fn world_registration(content: &WorldContent) -> WorldRegistration {
    let place_glossary: BTreeMap<String, String> = content
        .objects
        .iter()
        .map(|object| (object.id.clone(), object.label.clone()))
        .collect();
    WorldRegistration {
        world_id: "duskfell-poc".to_string(),
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
            VerbSpec {
                name: "leaveParty".to_string(),
                params: vec![ParamSpec {
                    name: "text".to_string(),
                    required: false,
                }],
            },
        ],
        lore: content
            .lore
            .clone()
            .unwrap_or_else(|| DEFAULT_LORE.to_string()),
        place_glossary,
        npcs: content
            .npcs
            .iter()
            .map(|npc| NpcBinding {
                npc_id: npc.id.clone(),
                persona_id: npc.persona.clone(),
            })
            .collect(),
    }
}

fn persona_registrations(personas: &HashMap<String, PersonaContent>) -> Vec<PersonaRegistration> {
    personas
        .values()
        .map(|persona| PersonaRegistration {
            id: persona.id.clone(),
            name: persona.name.clone(),
            role: persona.role.clone(),
            persona: persona.persona.clone(),
            drives: persona.drives.clone(),
            home_place: persona.home_place.clone(),
            party_policy: persona.party_policy.clone(),
            greets_players: persona.greets_players,
            canned: persona.cognition.canned.clone(),
        })
        .collect()
}
