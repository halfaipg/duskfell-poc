use super::{CompletionReply, CompletionRequest, ProviderError, TriggerFacts};

/// Deterministic scripted provider: replies are valid intent JSON derived
/// from the job facts, with zero network. Enables CI-safe end-to-end smokes
/// and offline development.
#[derive(Debug)]
pub struct MockProvider;

impl MockProvider {
    pub async fn complete(
        &self,
        request: &CompletionRequest,
    ) -> Result<CompletionReply, ProviderError> {
        let facts = &request.facts;
        let persona = &facts.persona;
        let intent = match &facts.trigger {
            TriggerFacts::Speech {
                actor_id,
                actor_name,
                text,
            } => {
                // Turn count proves the transcript flows into cognition.
                let turn = facts.transcript_turns;
                let reply = format!(
                    "{name} considers what {actor_name} said: \"{text}\". \
                     (mock cognition, turn {turn})",
                    name = persona.name,
                );
                serde_json::json!({
                    "verb": "say",
                    "params": { "targetId": actor_id, "text": reply }
                })
            }
            TriggerFacts::PartyInvite {
                invite_id,
                actor_name,
            } => {
                let reluctant = persona.party_policy.as_deref() == Some("reluctant");
                if reluctant {
                    serde_json::json!({
                        "verb": "declineParty",
                        "params": {
                            "inviteId": invite_id,
                            "text": format!("{}'s place is here, {actor_name}.", persona.name)
                        }
                    })
                } else {
                    serde_json::json!({
                        "verb": "acceptParty",
                        "params": { "inviteId": invite_id }
                    })
                }
            }
            TriggerFacts::Greeting {
                actor_id,
                actor_name,
            } => serde_json::json!({
                "verb": "say",
                "params": {
                    "targetId": actor_id,
                    "text": format!("Well met, {actor_name}.")
                }
            }),
        };
        Ok(CompletionReply {
            text: intent.to_string(),
            tokens_used: 0,
        })
    }
}
