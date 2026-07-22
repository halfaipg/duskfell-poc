use std::collections::HashMap;
use std::sync::atomic::Ordering::Relaxed;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, Mutex};
use tracing::warn;
use uuid::Uuid;

use crate::prompt::{self, PromptParts};
use crate::provider::{
    CompletionRequest, JobFacts, Provider, ProviderConfig, ProviderError, TriggerFacts,
};
use crate::scheduler::{GreetingDebounce, RequestBudget};
use crate::transcript::TranscriptStore;
use crate::{
    EngineConfig, EngineHandle, EngineMetrics, EngineOutput, EngineStatus, FallbackTrigger,
    GameEvent, IntentValidator, PersonaRegistration, WorldRegistration,
};

const OUTPUT_CHANNEL_CAPACITY: usize = 256;
const EVENT_CHANNEL_CAPACITY: usize = 256;
const AMBIENT_QUEUE_CAPACITY: usize = 8;
const GREETING_DEBOUNCE: Duration = Duration::from_secs(60);

#[derive(Debug)]
struct Job {
    npc_id: String,
    conversation_id: String,
    decision_id: String,
    trigger: TriggerFacts,
    fallback: FallbackTrigger,
    allowed_verbs: Vec<String>,
    bound_params: Vec<(String, String)>,
}

struct Shared {
    config: EngineConfig,
    world: WorldRegistration,
    validator: IntentValidator,
    personas: HashMap<String, PersonaRegistration>,
    bindings: HashMap<String, String>,
    stable_prompts: HashMap<String, String>,
    npc_lanes: HashMap<String, Arc<Mutex<()>>>,
    provider: Option<Provider>,
    transcripts: Mutex<TranscriptStore>,
    budget: Mutex<RequestBudget>,
    metrics: Arc<EngineMetrics>,
    outputs: mpsc::Sender<EngineOutput>,
}

pub(crate) fn spawn(
    config: EngineConfig,
    world: WorldRegistration,
    personas: Vec<PersonaRegistration>,
) -> EngineHandle {
    let (events_tx, events_rx) = mpsc::channel::<GameEvent>(EVENT_CHANNEL_CAPACITY);
    let (outputs_tx, outputs_rx) = mpsc::channel::<EngineOutput>(OUTPUT_CHANNEL_CAPACITY);
    let metrics = Arc::new(EngineMetrics::default());

    let validator = IntentValidator::new(&world.verbs);
    let persona_map: HashMap<String, PersonaRegistration> = personas
        .into_iter()
        .map(|persona| (persona.id.clone(), persona))
        .collect();
    let bindings: HashMap<String, String> = world
        .npcs
        .iter()
        .map(|binding| (binding.npc_id.clone(), binding.persona_id.clone()))
        .collect();
    let npc_lanes = bindings
        .keys()
        .map(|npc_id| (npc_id.clone(), Arc::new(Mutex::new(()))))
        .collect();
    // Stable per-NPC prompt prefixes, rendered once (stable-prefix discipline).
    let stable_prompts: HashMap<String, String> = bindings
        .iter()
        .filter_map(|(npc_id, persona_id)| {
            let persona = persona_map.get(persona_id)?;
            Some((
                npc_id.clone(),
                prompt::system_stable(&world, &validator, persona),
            ))
        })
        .collect();

    let (provider, status, status_watch) = match Provider::from_config(&config.provider) {
        Ok(provider) => {
            let status_watch = provider.status_watch();
            let status = match &status_watch {
                Some(watch) => watch.borrow().clone(),
                None => match config.provider {
                    ProviderConfig::Mock => EngineStatus::MockOnly,
                    ProviderConfig::OpenAiCompatible { .. } => EngineStatus::Live,
                },
            };
            (Some(provider), status, status_watch)
        }
        Err(reason) => (None, EngineStatus::Degraded { reason }, None),
    };

    let requests_per_minute = config.requests_per_minute;
    let max_concurrent_jobs = config.max_concurrent_jobs.max(1);
    let queue_capacity = config.queue_capacity.max(1);
    let shared = Arc::new(Shared {
        config,
        world,
        validator,
        personas: persona_map,
        bindings,
        stable_prompts,
        npc_lanes,
        provider,
        transcripts: Mutex::new(TranscriptStore::default()),
        budget: Mutex::new(RequestBudget::new(requests_per_minute)),
        metrics: metrics.clone(),
        outputs: outputs_tx.clone(),
    });

    let (interactive_tx, interactive_rx) = mpsc::channel::<Job>(queue_capacity);
    let (ambient_tx, ambient_rx) = mpsc::channel::<Job>(AMBIENT_QUEUE_CAPACITY);

    {
        let shared = shared.clone();
        let status = status.clone();
        tokio::spawn(async move {
            let _ = shared
                .outputs
                .send(EngineOutput::StatusChanged { status })
                .await;
            run_event_loop(shared, events_rx, interactive_tx, ambient_tx).await;
        });
    }

    // Forward provider health transitions (models probe) to the host.
    if let Some(mut status_watch) = status_watch {
        let outputs = outputs_tx.clone();
        tokio::spawn(async move {
            while status_watch.changed().await.is_ok() {
                let status = status_watch.borrow_and_update().clone();
                if outputs
                    .send(EngineOutput::StatusChanged { status })
                    .await
                    .is_err()
                {
                    return;
                }
            }
        });
    }

    // Bounded worker pool sharing the two queues. Interactive dialogue gets
    // the reserved lane by biased polling; ambient jobs use leftovers.
    let interactive_rx = Arc::new(Mutex::new(interactive_rx));
    let ambient_rx = Arc::new(Mutex::new(ambient_rx));
    for _ in 0..max_concurrent_jobs {
        let shared = shared.clone();
        let interactive_rx = interactive_rx.clone();
        let ambient_rx = ambient_rx.clone();
        tokio::spawn(async move {
            run_worker(shared, interactive_rx, ambient_rx).await;
        });
    }

    EngineHandle {
        events: events_tx,
        outputs: outputs_rx,
        metrics,
    }
}

async fn run_event_loop(
    shared: Arc<Shared>,
    mut events: mpsc::Receiver<GameEvent>,
    interactive_tx: mpsc::Sender<Job>,
    ambient_tx: mpsc::Sender<Job>,
) {
    let mut greeting_debounce = GreetingDebounce::new(GREETING_DEBOUNCE);
    while let Some(event) = events.recv().await {
        match event {
            GameEvent::ActorSpoke {
                npc_id,
                actor_id,
                actor_name,
                text,
            } => {
                let conversation_id = conversation_id(&npc_id, &actor_id);
                shared
                    .transcripts
                    .lock()
                    .await
                    .record(&conversation_id, &actor_name, &text);
                let job = Job {
                    conversation_id,
                    decision_id: Uuid::new_v4().to_string(),
                    trigger: TriggerFacts::Speech {
                        actor_id: actor_id.clone(),
                        actor_name,
                        text,
                    },
                    fallback: FallbackTrigger::Speech {
                        actor_id: actor_id.clone(),
                    },
                    npc_id,
                    allowed_verbs: vec!["say".to_string()],
                    bound_params: vec![("targetId".to_string(), actor_id)],
                };
                enqueue_interactive(&shared, &interactive_tx, job).await;
            }
            GameEvent::PartyInvite {
                npc_id,
                invite_id,
                actor_id,
                actor_name,
            } => {
                let job = Job {
                    conversation_id: conversation_id(&npc_id, &actor_id),
                    decision_id: Uuid::new_v4().to_string(),
                    trigger: TriggerFacts::PartyInvite {
                        invite_id: invite_id.clone(),
                        actor_name,
                    },
                    fallback: FallbackTrigger::PartyInvite {
                        invite_id: invite_id.clone(),
                    },
                    npc_id,
                    allowed_verbs: vec!["acceptParty".to_string(), "declineParty".to_string()],
                    bound_params: vec![("inviteId".to_string(), invite_id)],
                };
                enqueue_interactive(&shared, &interactive_tx, job).await;
            }
            GameEvent::ActorLingered {
                npc_id,
                actor_id,
                actor_name,
            } => {
                let greets = shared
                    .bindings
                    .get(&npc_id)
                    .and_then(|persona_id| shared.personas.get(persona_id))
                    .map(|persona| persona.greets_players)
                    .unwrap_or(false);
                if !greets || !greeting_debounce.allow(&npc_id, &actor_id) {
                    continue;
                }
                let job = Job {
                    conversation_id: conversation_id(&npc_id, &actor_id),
                    decision_id: Uuid::new_v4().to_string(),
                    trigger: TriggerFacts::Greeting {
                        actor_id: actor_id.clone(),
                        actor_name,
                    },
                    fallback: FallbackTrigger::Greeting {
                        actor_id: actor_id.clone(),
                    },
                    npc_id,
                    allowed_verbs: vec!["say".to_string()],
                    bound_params: vec![("targetId".to_string(), actor_id)],
                };
                // Ambient jobs drop on full: a skipped greeting is harmless.
                if ambient_tx.try_send(job).is_err() {
                    shared.metrics.dropped_jobs_total.fetch_add(1, Relaxed);
                }
            }
            GameEvent::PartyChanged { .. } => {}
            GameEvent::IntentRejected {
                npc_id,
                decision_id,
                reason,
            } => {
                warn!(npc_id, decision_id, reason, "host rejected npc intent");
            }
        }
    }
}

async fn enqueue_interactive(shared: &Arc<Shared>, queue: &mpsc::Sender<Job>, job: Job) {
    match queue.try_send(job) {
        Ok(()) => {}
        Err(mpsc::error::TrySendError::Full(job)) | Err(mpsc::error::TrySendError::Closed(job)) => {
            shared.metrics.dropped_jobs_total.fetch_add(1, Relaxed);
            emit_job_fallback(shared, job).await;
        }
    }
}

async fn run_worker(
    shared: Arc<Shared>,
    interactive_rx: Arc<Mutex<mpsc::Receiver<Job>>>,
    ambient_rx: Arc<Mutex<mpsc::Receiver<Job>>>,
) {
    loop {
        // Prefer interactive work; poll ambient only when idle.
        let job = {
            let mut interactive = interactive_rx.lock().await;
            match interactive.try_recv() {
                Ok(job) => Some(job),
                Err(mpsc::error::TryRecvError::Empty) => None,
                Err(mpsc::error::TryRecvError::Disconnected) => return,
            }
        };
        let job = match job {
            Some(job) => job,
            None => {
                let ambient = {
                    let mut ambient = ambient_rx.lock().await;
                    ambient.try_recv().ok()
                };
                match ambient {
                    Some(job) => job,
                    None => {
                        // Idle: block on the interactive queue briefly.
                        let waited = {
                            let mut interactive = interactive_rx.lock().await;
                            tokio::time::timeout(Duration::from_millis(50), interactive.recv())
                                .await
                        };
                        match waited {
                            Ok(Some(job)) => job,
                            Ok(None) => return,
                            Err(_) => continue,
                        }
                    }
                }
            }
        };
        let lane = shared.npc_lanes.get(&job.npc_id).cloned();
        if let Some(lane) = lane {
            let _guard = lane.lock().await;
            process_job(&shared, job).await;
        } else {
            emit_job_fallback(&shared, job).await;
        }
    }
}

async fn process_job(shared: &Arc<Shared>, job: Job) {
    let Some(provider) = shared.provider.as_ref() else {
        emit_job_fallback(shared, job).await;
        return;
    };
    let Some(persona) = shared
        .bindings
        .get(&job.npc_id)
        .and_then(|persona_id| shared.personas.get(persona_id))
    else {
        warn!(npc_id = %job.npc_id, "no persona bound for npc");
        emit_job_fallback(shared, job).await;
        return;
    };

    let (transcript_turns, turns) = {
        let transcripts = shared.transcripts.lock().await;
        (
            transcripts.turn_count(&job.conversation_id),
            transcripts.turns(&job.conversation_id),
        )
    };
    let system_stable = shared
        .stable_prompts
        .get(&job.npc_id)
        .cloned()
        .unwrap_or_else(|| prompt::system_stable(&shared.world, &shared.validator, persona));
    let trigger_line = describe_trigger(&job.trigger);
    let request = CompletionRequest {
        prompt: PromptParts {
            system_stable,
            user_turn: prompt::user_turn(&turns, &trigger_line),
        },
        facts: JobFacts {
            npc_id: job.npc_id.clone(),
            persona: persona.clone(),
            trigger: job.trigger.clone(),
            transcript_turns,
        },
        max_tokens: shared.config.max_reply_tokens,
    };

    match complete_validated(
        shared,
        provider,
        request,
        &job.allowed_verbs,
        &job.bound_params,
    )
    .await
    {
        Ok(intent) => {
            // Record spoken replies so follow-ups stay coherent. Any verb with
            // a string `text` param counts as speech; the engine stays
            // verb-agnostic beyond that.
            if let Some(text) = intent.params.get("text").and_then(|text| text.as_str()) {
                shared
                    .transcripts
                    .lock()
                    .await
                    .record(&job.conversation_id, &persona.name, text);
            }
            let in_reply_to_actor = match &job.trigger {
                TriggerFacts::Speech { actor_id, .. } | TriggerFacts::Greeting { actor_id, .. } => {
                    Some(actor_id.clone())
                }
                TriggerFacts::PartyInvite { .. } => None,
            };
            let _ = shared
                .outputs
                .send(EngineOutput::Intent {
                    npc_id: job.npc_id,
                    decision_id: job.decision_id,
                    verb: intent.verb,
                    params: intent.params,
                    in_reply_to_actor,
                })
                .await;
        }
        Err(reason) => {
            warn!(npc_id = %job.npc_id, %reason, "cognition failed, falling back");
            emit_job_fallback(shared, job).await;
        }
    }
}

async fn complete_validated(
    shared: &Arc<Shared>,
    provider: &Provider,
    mut request: CompletionRequest,
    allowed_verbs: &[String],
    bound_params: &[(String, String)],
) -> Result<crate::ValidatedIntent, String> {
    let timeout = shared.config.interactive_timeout;
    for attempt in 0..2 {
        if !shared.budget.lock().await.try_spend() {
            return Err("request budget exhausted".to_string());
        }
        shared.metrics.requests_total.fetch_add(1, Relaxed);
        let reply = tokio::time::timeout(timeout, provider.complete(&request))
            .await
            .map_err(|_| "provider timed out".to_string())?;
        match reply {
            Ok(reply) => {
                shared
                    .metrics
                    .tokens_total
                    .fetch_add(reply.tokens_used, Relaxed);
                match shared
                    .validator
                    .validate_allowed(&reply.text, allowed_verbs)
                {
                    Ok(intent) => match validate_bound_params(intent, bound_params) {
                        Ok(intent) => return Ok(intent),
                        Err(schema_error) if attempt == 0 => {
                            shared.metrics.schema_retries_total.fetch_add(1, Relaxed);
                            request.prompt.user_turn.push_str(&format!(
                                "\nYour previous reply was rejected ({schema_error}). Respond with ONLY the JSON object."
                            ));
                        }
                        Err(schema_error) => {
                            return Err(format!("schema validation failed twice: {schema_error}"))
                        }
                    },
                    Err(schema_error) if attempt == 0 => {
                        // One bounded corrective retry (design D5).
                        shared.metrics.schema_retries_total.fetch_add(1, Relaxed);
                        request.prompt.user_turn.push_str(&format!(
                            "\nYour previous reply was rejected ({schema_error}). \
                             Respond with ONLY the JSON object."
                        ));
                    }
                    Err(schema_error) => {
                        return Err(format!("schema validation failed twice: {schema_error}"))
                    }
                }
            }
            Err(ProviderError::RateLimited) => return Err("provider rate limited".to_string()),
            Err(err) => return Err(err.to_string()),
        }
    }
    unreachable!("retry loop returns on second attempt")
}

fn validate_bound_params(
    intent: crate::ValidatedIntent,
    bound_params: &[(String, String)],
) -> Result<crate::ValidatedIntent, String> {
    for (name, expected) in bound_params {
        if let Some(actual) = intent.params.get(name).and_then(|value| value.as_str()) {
            if actual != expected {
                return Err(format!(
                    "param '{name}' does not match the triggering event"
                ));
            }
        }
    }
    Ok(intent)
}

fn conversation_id(npc_id: &str, actor_id: &str) -> String {
    format!("{npc_id}\u{1f}{actor_id}")
}

fn describe_trigger(trigger: &TriggerFacts) -> String {
    match trigger {
        TriggerFacts::Speech {
            actor_name, text, ..
        } => format!("{actor_name} says to you: \"{text}\""),
        TriggerFacts::PartyInvite {
            actor_name,
            invite_id,
        } => format!(
            "{actor_name} invites you to travel with them. Decide in character: accept with \
             the acceptParty verb or decline with declineParty. Either way set the inviteId \
             param to exactly \"{invite_id}\"."
        ),
        TriggerFacts::Greeting { actor_name, .. } => {
            format!("{actor_name} is lingering nearby. Offer a short greeting.")
        }
    }
}

async fn emit_job_fallback(shared: &Arc<Shared>, job: Job) {
    shared.metrics.fallbacks_total.fetch_add(1, Relaxed);
    let _ = shared
        .outputs
        .send(EngineOutput::Fallback {
            npc_id: job.npc_id,
            decision_id: job.decision_id,
            trigger: job.fallback,
        })
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_model_params_bound_to_a_different_event() {
        let intent = crate::ValidatedIntent {
            verb: "acceptParty".to_string(),
            params: serde_json::json!({ "inviteId": "stale-invite" }),
        };
        let error = validate_bound_params(
            intent,
            &[("inviteId".to_string(), "current-invite".to_string())],
        )
        .expect_err("stale model output must not apply to a new event");
        assert!(error.contains("triggering event"));
    }
}
