use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use animus::{
    Engine, EngineConfig, EngineHandle, EngineOutput, EngineStatus, GameEvent, NpcBinding,
    ParamSpec, PersonaRegistration, ProviderConfig, VerbSpec, WorldRegistration,
};
use tokio::sync::{mpsc, Mutex};
use tracing::{info, warn};

use crate::config::{
    env_bool, env_optional_nonempty_string, env_positive_u32, env_positive_u64, env_positive_usize,
};
use crate::content::WorldContent;
use crate::protocol::PlayerId;
use crate::sim::{ActorId, ActorIntent};
use crate::AppState;

const DEFAULT_BASE_URL: &str = "https://api.aipowergrid.io";
const DEFAULT_LORE: &str = "Duskfell is a hard frontier settlement rebuilding among old ruins. The Bank records claims, the Field Forge turns salvage into tools, and no one agrees what still wakes beyond the settled ground.";

#[derive(Clone)]
pub(crate) struct CognitionBridge {
    pub(crate) events: mpsc::Sender<GameEvent>,
    pub(crate) status: Arc<Mutex<EngineStatus>>,
}

pub(crate) fn maybe_spawn(
    content: &WorldContent,
) -> anyhow::Result<Option<(CognitionBridge, mpsc::Receiver<EngineOutput>)>> {
    if !env_bool("ANIMUS_ENABLED", true)? {
        return Ok(None);
    }
    let provider_mode = std::env::var("ANIMUS_PROVIDER").unwrap_or_else(|_| "auto".to_string());
    let api_key = env_optional_nonempty_string("ANIMUS_API_KEY")?;
    let base_url = std::env::var("ANIMUS_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
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
        "openai-compatible" => ProviderConfig::OpenAiCompatible {
            base_url,
            api_key: api_key.ok_or_else(|| {
                anyhow::anyhow!("ANIMUS_PROVIDER=openai-compatible requires ANIMUS_API_KEY")
            })?,
            model,
        },
        other => {
            return Err(anyhow::anyhow!(
                "ANIMUS_PROVIDER must be auto, mock, or openai-compatible; got '{other}'"
            ));
        }
    };

    let world = WorldRegistration {
        world_id: "duskfell".to_string(),
        verbs: vec![VerbSpec {
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
        }],
        lore: DEFAULT_LORE.to_string(),
        place_glossary: content
            .objects
            .iter()
            .map(|object| (object.id.clone(), object.label.clone()))
            .collect::<BTreeMap<_, _>>(),
        npcs: content
            .npcs
            .iter()
            .map(|npc| NpcBinding {
                npc_id: npc.id.clone(),
                persona_id: npc.id.clone(),
            })
            .collect(),
    };
    let personas = content
        .npcs
        .iter()
        .map(|npc| PersonaRegistration {
            id: npc.id.clone(),
            name: npc.name.clone(),
            role: npc.role.clone(),
            persona: npc.persona.clone(),
            drives: npc.drives.clone(),
            home_place: None,
            party_policy: None,
            greets_players: false,
            canned: npc.canned.clone(),
        })
        .collect();
    let config = EngineConfig {
        provider,
        max_concurrent_jobs: env_positive_usize("ANIMUS_MAX_CONCURRENT_JOBS", 2)?,
        queue_capacity: env_positive_usize("ANIMUS_QUEUE_CAPACITY", 32)?,
        requests_per_minute: env_positive_u32("ANIMUS_REQUESTS_PER_MINUTE", 20)?,
        interactive_timeout: Duration::from_millis(env_positive_u64(
            "ANIMUS_INTERACTIVE_TIMEOUT_MS",
            15_000,
        )?),
        max_reply_tokens: env_positive_u32("ANIMUS_MAX_REPLY_TOKENS", 192)?,
    };
    let EngineHandle {
        events,
        outputs,
        metrics: _,
    } = Engine::spawn(config, world, personas);
    let status = Arc::new(Mutex::new(EngineStatus::Degraded {
        reason: "starting".to_string(),
    }));
    Ok(Some((CognitionBridge { events, status }, outputs)))
}

pub(crate) async fn run_output_pump(state: AppState, mut outputs: mpsc::Receiver<EngineOutput>) {
    while let Some(output) = outputs.recv().await {
        match output {
            EngineOutput::Intent {
                npc_id,
                decision_id,
                verb,
                params,
                in_reply_to_actor,
            } => {
                if verb != "say" {
                    warn!(npc_id, decision_id, verb, "rejected unsupported npc intent");
                    continue;
                }
                let Some(actor_id) = in_reply_to_actor
                    .as_deref()
                    .and_then(|value| value.parse::<PlayerId>().ok())
                else {
                    warn!(
                        npc_id,
                        decision_id, "rejected npc reply without actor context"
                    );
                    continue;
                };
                let Some(text) = params.get("text").and_then(|value| value.as_str()) else {
                    warn!(npc_id, decision_id, "rejected npc reply without text");
                    continue;
                };
                let result = state.sim.lock().await.apply_actor_intent(
                    ActorId::Npc(npc_id.clone()),
                    ActorIntent::Say {
                        text: text.to_string(),
                        audience: Some(actor_id),
                    },
                );
                if let Err(reason) = result {
                    warn!(
                        npc_id,
                        decision_id,
                        reason = reason.as_log_reason(),
                        "rejected npc intent at simulation boundary"
                    );
                }
            }
            EngineOutput::Fallback {
                npc_id, trigger, ..
            } => {
                let actor_id = match trigger {
                    animus::FallbackTrigger::Speech { actor_id }
                    | animus::FallbackTrigger::Greeting { actor_id } => {
                        actor_id.parse::<PlayerId>().ok()
                    }
                    animus::FallbackTrigger::PartyInvite { .. } => None,
                };
                let Some(actor_id) = actor_id else {
                    continue;
                };
                let result = state
                    .sim
                    .lock()
                    .await
                    .apply_npc_canned_intent(&npc_id, actor_id);
                if let Err(reason) = result {
                    warn!(
                        npc_id,
                        reason = reason.as_log_reason(),
                        "rejected npc fallback at simulation boundary"
                    );
                }
            }
            EngineOutput::StatusChanged { status } => {
                info!(status = %status.detail(), "npc cognition status changed");
                if let Some(bridge) = &state.cognition {
                    *bridge.status.lock().await = status;
                }
            }
        }
    }
}
