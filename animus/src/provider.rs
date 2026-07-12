pub mod mock;
pub mod openai_compatible;

use crate::prompt::PromptParts;
use crate::{EngineStatus, PersonaRegistration};

/// Provider selection is deployment config; the engine is provider-agnostic.
#[derive(Clone)]
pub enum ProviderConfig {
    /// Deterministic scripted provider for CI and offline development.
    Mock,
    /// Any OpenAI-compatible chat-completions backend (first-party target:
    /// AI Power Grid).
    OpenAiCompatible {
        base_url: String,
        api_key: String,
        model: Option<String>,
    },
}

// The API key must never reach logs or debug output (design D14).
impl std::fmt::Debug for ProviderConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProviderConfig::Mock => write!(f, "Mock"),
            ProviderConfig::OpenAiCompatible {
                base_url, model, ..
            } => f
                .debug_struct("OpenAiCompatible")
                .field("base_url", base_url)
                .field("api_key", &"<redacted>")
                .field("model", model)
                .finish(),
        }
    }
}

/// Context a provider may use beyond the rendered prompt. The mock provider
/// answers from this structure; network providers serialize the prompt.
#[derive(Debug, Clone)]
pub struct JobFacts {
    pub npc_id: String,
    pub persona: PersonaRegistration,
    pub trigger: TriggerFacts,
    pub transcript_turns: usize,
}

#[derive(Debug, Clone)]
pub enum TriggerFacts {
    Speech {
        actor_id: String,
        actor_name: String,
        text: String,
    },
    PartyInvite {
        invite_id: String,
        actor_name: String,
    },
    Greeting {
        actor_id: String,
        actor_name: String,
    },
}

#[derive(Debug, Clone)]
pub struct CompletionRequest {
    pub prompt: PromptParts,
    pub facts: JobFacts,
    pub max_tokens: u32,
}

#[derive(Debug, Clone)]
pub struct CompletionReply {
    pub text: String,
    pub tokens_used: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProviderError {
    Unavailable { reason: String },
    RateLimited,
    Failed { reason: String },
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProviderError::Unavailable { reason } => write!(f, "provider unavailable: {reason}"),
            ProviderError::RateLimited => write!(f, "provider rate limited"),
            ProviderError::Failed { reason } => write!(f, "provider failed: {reason}"),
        }
    }
}

#[derive(Debug)]
pub enum Provider {
    Mock(mock::MockProvider),
    OpenAiCompatible(openai_compatible::OpenAiCompatibleProvider),
}

impl Provider {
    /// Must run on a tokio runtime: network providers spawn a health probe.
    pub fn from_config(config: &ProviderConfig) -> Result<Self, String> {
        match config {
            ProviderConfig::Mock => Ok(Provider::Mock(mock::MockProvider)),
            ProviderConfig::OpenAiCompatible {
                base_url,
                api_key,
                model,
            } => Ok(Provider::OpenAiCompatible(
                openai_compatible::OpenAiCompatibleProvider::spawn(
                    base_url.clone(),
                    api_key.clone(),
                    model.clone(),
                ),
            )),
        }
    }

    /// Health transitions, when the provider tracks them (network providers).
    pub fn status_watch(&self) -> Option<tokio::sync::watch::Receiver<EngineStatus>> {
        match self {
            Provider::Mock(_) => None,
            Provider::OpenAiCompatible(provider) => Some(provider.status_watch()),
        }
    }

    pub async fn complete(
        &self,
        request: &CompletionRequest,
    ) -> Result<CompletionReply, ProviderError> {
        match self {
            Provider::Mock(mock) => mock.complete(request).await,
            Provider::OpenAiCompatible(provider) => provider.complete(request).await,
        }
    }
}
