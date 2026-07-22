use std::collections::HashMap;

use crate::{ParamSpec, VerbSpec};

/// Compiled from the registered verb list; strictly validates every model
/// response (design D5). A response must be a single JSON object of the shape
/// `{"verb": "<registered>", "params": { ... declared string params ... }}`.
#[derive(Debug, Clone)]
pub struct IntentValidator {
    verbs: HashMap<String, Vec<ParamSpec>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ValidatedIntent {
    pub verb: String,
    pub params: serde_json::Value,
}

impl IntentValidator {
    pub fn new(verbs: &[VerbSpec]) -> Self {
        Self {
            verbs: verbs
                .iter()
                .map(|verb| (verb.name.clone(), verb.params.clone()))
                .collect(),
        }
    }

    /// Renders the response contract into the prompt's system framing.
    pub fn schema_prompt(&self) -> String {
        let mut verbs: Vec<&String> = self.verbs.keys().collect();
        verbs.sort();
        let mut out = String::from(
            "Respond with ONLY one JSON object: {\"verb\": <verb>, \"params\": {..}}. Verbs:\n",
        );
        for name in verbs {
            let params = &self.verbs[name];
            let rendered: Vec<String> = params
                .iter()
                .map(|param| {
                    if param.required {
                        format!("{} (required string)", param.name)
                    } else {
                        format!("{} (optional string)", param.name)
                    }
                })
                .collect();
            out.push_str(&format!("- {name}: params {{ {} }}\n", rendered.join(", ")));
        }
        out
    }

    pub fn validate(&self, raw: &str) -> Result<ValidatedIntent, String> {
        let trimmed = extract_json_object(raw).ok_or("response contains no JSON object")?;
        let value: serde_json::Value =
            serde_json::from_str(trimmed).map_err(|err| format!("invalid JSON: {err}"))?;
        let object = value.as_object().ok_or("response is not a JSON object")?;
        let verb = object
            .get("verb")
            .and_then(|verb| verb.as_str())
            .ok_or("missing string field 'verb'")?;
        let declared = self
            .verbs
            .get(verb)
            .ok_or_else(|| format!("verb '{verb}' is not registered"))?;
        let empty = serde_json::Map::new();
        let params = match object.get("params") {
            None => &empty,
            Some(params) => params.as_object().ok_or("'params' must be an object")?,
        };
        for param in declared {
            match params.get(&param.name) {
                Some(value) if value.is_string() => {}
                Some(_) => return Err(format!("param '{}' must be a string", param.name)),
                None if param.required => {
                    return Err(format!("missing required param '{}'", param.name))
                }
                None => {}
            }
        }
        for key in params.keys() {
            if !declared.iter().any(|param| &param.name == key) {
                return Err(format!("param '{key}' is not declared for verb '{verb}'"));
            }
        }
        Ok(ValidatedIntent {
            verb: verb.to_string(),
            params: serde_json::Value::Object(params.clone()),
        })
    }

    pub fn validate_allowed(
        &self,
        raw: &str,
        allowed_verbs: &[String],
    ) -> Result<ValidatedIntent, String> {
        let intent = self.validate(raw)?;
        if !allowed_verbs.iter().any(|verb| verb == &intent.verb) {
            return Err(format!(
                "verb '{}' is not allowed for this event",
                intent.verb
            ));
        }
        Ok(intent)
    }
}

/// Models often wrap JSON in prose or code fences; accept exactly one
/// embedded object rather than failing on the wrapper.
fn extract_json_object(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(&raw[start..=end])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn validator() -> IntentValidator {
        IntentValidator::new(&[
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
        ])
    }

    #[test]
    fn accepts_declared_verb_with_valid_params() {
        let intent = validator()
            .validate(r#"{"verb":"say","params":{"targetId":"p1","text":"hello"}}"#)
            .expect("valid intent");
        assert_eq!(intent.verb, "say");
        assert_eq!(intent.params["text"], "hello");
    }

    #[test]
    fn accepts_json_wrapped_in_prose_or_fences() {
        let raw = "Sure!\n```json\n{\"verb\":\"say\",\"params\":{\"text\":\"hi\"}}\n```";
        assert!(validator().validate(raw).is_ok());
    }

    #[test]
    fn rejects_prose_undeclared_verbs_and_bad_params() {
        let validator = validator();
        assert!(validator.validate("I think I will decline.").is_err());
        assert!(validator
            .validate(r#"{"verb":"attack","params":{"text":"x"}}"#)
            .is_err());
        assert!(
            validator.validate(r#"{"verb":"say","params":{}}"#).is_err(),
            "missing required text"
        );
        assert!(
            validator
                .validate(r#"{"verb":"say","params":{"text":42}}"#)
                .is_err(),
            "non-string param"
        );
        assert!(
            validator
                .validate(r#"{"verb":"say","params":{"text":"x","evil":"y"}}"#)
                .is_err(),
            "undeclared param"
        );
        assert!(
            validator
                .validate(r#"{"verb":"acceptParty","params":{}}"#)
                .is_err(),
            "missing inviteId"
        );
    }

    #[test]
    fn schema_prompt_lists_registered_verbs() {
        let prompt = validator().schema_prompt();
        assert!(prompt.contains("- say:"));
        assert!(prompt.contains("- acceptParty:"));
        assert!(prompt.contains("text (required string)"));
    }

    #[test]
    fn rejects_registered_verb_when_event_does_not_allow_it() {
        let error = validator()
            .validate_allowed(
                r#"{"verb":"acceptParty","params":{"inviteId":"invite-1"}}"#,
                &["say".to_string()],
            )
            .expect_err("speech events must not authorize party intents");
        assert!(error.contains("not allowed for this event"));
    }
}
