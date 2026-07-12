//! Animus — a game-agnostic NPC cognition engine.
//!
//! The engine knows entities, events, verbs, and places — never the host
//! game's nouns. The game registers its vocabulary (verbs) and characters
//! (personas) as data, streams perception events in, and receives validated
//! intents out. The engine never mutates game state: the game validates and
//! executes every intent (the authority boundary).
//!
//! Interface v1: typed events/intents over tokio channels, in-process.
//! A network wrapper for non-Rust hosts serializes these same types later.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

mod engine;
mod intent_schema;
mod prompt;
pub mod provider;
mod scheduler;
mod transcript;

pub use intent_schema::{IntentValidator, ValidatedIntent};
pub use provider::ProviderConfig;

#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub provider: ProviderConfig,
    pub max_concurrent_jobs: usize,
    pub queue_capacity: usize,
    pub requests_per_minute: u32,
    pub interactive_timeout: Duration,
    pub max_reply_tokens: u32,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            provider: ProviderConfig::Mock,
            max_concurrent_jobs: 2,
            queue_capacity: 32,
            requests_per_minute: 20,
            interactive_timeout: Duration::from_millis(15_000),
            max_reply_tokens: 256,
        }
    }
}

/// The game's vocabulary, declared at startup (§3.1). The engine has no
/// built-in nouns or verbs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldRegistration {
    pub world_id: String,
    pub verbs: Vec<VerbSpec>,
    /// One paragraph of world context injected into every prompt (prefix-stable).
    pub lore: String,
    pub place_glossary: BTreeMap<String, String>,
    /// Which character (persona) each NPC embodies.
    pub npcs: Vec<NpcBinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpcBinding {
    pub npc_id: String,
    pub persona_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerbSpec {
    pub name: String,
    pub params: Vec<ParamSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParamSpec {
    pub name: String,
    pub required: bool,
}

/// A character, shipped by the game as content (§3.2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaRegistration {
    pub id: String,
    pub name: String,
    pub role: String,
    pub persona: String,
    pub drives: Vec<String>,
    pub home_place: Option<String>,
    pub party_policy: Option<String>,
    pub greets_players: bool,
    /// Persona-appropriate lines the host can fall back to; the engine only
    /// references their existence, delivery stays host-side.
    pub canned: Vec<String>,
}

/// What an NPC perceives (game → engine, §3.3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GameEvent {
    ActorSpoke {
        npc_id: String,
        actor_id: String,
        actor_name: String,
        text: String,
    },
    PartyInvite {
        npc_id: String,
        invite_id: String,
        actor_id: String,
        actor_name: String,
    },
    /// Ambient social context worth remembering; never triggers cognition.
    PartyChanged { npc_id: String, detail: String },
    /// The game rejected one of this engine's intents (authority boundary).
    IntentRejected {
        npc_id: String,
        decision_id: String,
        reason: String,
    },
    ActorLingered {
        npc_id: String,
        actor_id: String,
        actor_name: String,
    },
}

/// What the engine suggests (engine → game, §3.4). The game validates and
/// executes; it may reject any intent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EngineOutput {
    Intent {
        npc_id: String,
        decision_id: String,
        verb: String,
        params: serde_json::Value,
        /// The actor whose event triggered this decision, when there was one.
        /// Models routinely omit optional params like a say target; the host
        /// can route the reply to this actor instead of dropping the intent.
        in_reply_to_actor: Option<String>,
    },
    /// Cognition was unavailable (timeout, budget, queue, provider down).
    /// The host should respond deterministically (canned line, safe default).
    Fallback {
        npc_id: String,
        decision_id: String,
        trigger: FallbackTrigger,
    },
    StatusChanged {
        status: EngineStatus,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FallbackTrigger {
    Speech { actor_id: String },
    PartyInvite { invite_id: String },
    Greeting { actor_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EngineStatus {
    Live,
    MockOnly,
    Degraded { reason: String },
}

impl EngineStatus {
    pub fn detail(&self) -> String {
        match self {
            EngineStatus::Live => "live".to_string(),
            EngineStatus::MockOnly => "mock-only".to_string(),
            EngineStatus::Degraded { reason } => format!("degraded: {reason}"),
        }
    }
}

/// Counters surfaced to the host's metrics pipeline.
#[derive(Debug, Default)]
pub struct EngineMetrics {
    pub requests_total: std::sync::atomic::AtomicU64,
    pub tokens_total: std::sync::atomic::AtomicU64,
    pub fallbacks_total: std::sync::atomic::AtomicU64,
    pub dropped_jobs_total: std::sync::atomic::AtomicU64,
    pub schema_retries_total: std::sync::atomic::AtomicU64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct EngineMetricsSnapshot {
    pub requests_total: u64,
    pub tokens_total: u64,
    pub fallbacks_total: u64,
    pub dropped_jobs_total: u64,
    pub schema_retries_total: u64,
}

impl EngineMetrics {
    pub fn snapshot(&self) -> EngineMetricsSnapshot {
        use std::sync::atomic::Ordering::Relaxed;
        EngineMetricsSnapshot {
            requests_total: self.requests_total.load(Relaxed),
            tokens_total: self.tokens_total.load(Relaxed),
            fallbacks_total: self.fallbacks_total.load(Relaxed),
            dropped_jobs_total: self.dropped_jobs_total.load(Relaxed),
            schema_retries_total: self.schema_retries_total.load(Relaxed),
        }
    }
}

/// The host's handle to a running engine.
pub struct EngineHandle {
    pub events: mpsc::Sender<GameEvent>,
    /// Take once; every interactive event produces exactly one Intent or
    /// Fallback here (plus StatusChanged transitions).
    pub outputs: mpsc::Receiver<EngineOutput>,
    pub metrics: Arc<EngineMetrics>,
}

pub struct Engine;

impl Engine {
    /// Spawns the engine's async tasks on the current tokio runtime.
    pub fn spawn(
        config: EngineConfig,
        world: WorldRegistration,
        personas: Vec<PersonaRegistration>,
    ) -> EngineHandle {
        engine::spawn(config, world, personas)
    }
}
