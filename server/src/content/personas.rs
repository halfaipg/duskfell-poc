use std::collections::HashMap;
use std::fs;
use std::path::Path;

use anyhow::{anyhow, Context};
use serde::Deserialize;

use super::hash::stable_content_hash;

pub const MAX_PERSONA_FILE_BYTES: u64 = 8 * 1024;
pub const MAX_PERSONA_CANNED_LINES: usize = 8;
pub const MAX_PERSONA_CANNED_LINE_CHARS: usize = 200;
pub const MAX_PERSONA_TEXT_CHARS: usize = 2000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
// Fields beyond `cognition.canned` feed the cognition engine's persona
// registration (stage 3); the canned responder only needs the lines.
#[allow(dead_code)]
pub struct PersonaContent {
    pub id: String,
    pub name: String,
    pub role: String,
    pub persona: String,
    #[serde(default)]
    pub drives: Vec<String>,
    #[serde(default)]
    pub home_place: Option<String>,
    #[serde(default)]
    pub party_policy: Option<String>,
    #[serde(default)]
    pub greets_players: bool,
    pub cognition: PersonaCognition,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonaCognition {
    #[serde(default = "default_cognition_tier")]
    #[allow(dead_code)]
    pub tier: String,
    pub canned: Vec<String>,
}

fn default_cognition_tier() -> String {
    "standard".to_string()
}

#[derive(Debug, Clone)]
pub struct LoadedPersonas {
    pub personas: HashMap<String, PersonaContent>,
    pub personas_hash: String,
}

/// Loads every `<id>.json` persona in `dir`, validated with the same
/// discipline as world content. `referenced` lists the persona ids the world
/// content requires; each must resolve to a file.
pub fn load_personas(
    dir: impl AsRef<Path>,
    referenced: &[String],
) -> anyhow::Result<LoadedPersonas> {
    let dir = dir.as_ref();
    let mut personas = HashMap::new();
    let mut hashed_entries: Vec<(String, String)> = Vec::new();

    if dir.is_dir() {
        for entry in fs::read_dir(dir)
            .with_context(|| format!("failed to read personas dir {}", dir.display()))?
        {
            let path = entry?.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let metadata = fs::metadata(&path)?;
            if metadata.len() > MAX_PERSONA_FILE_BYTES {
                return Err(anyhow!(
                    "persona file {} exceeds {} bytes",
                    path.display(),
                    MAX_PERSONA_FILE_BYTES
                ));
            }
            let raw = fs::read_to_string(&path)
                .with_context(|| format!("failed to read persona {}", path.display()))?;
            let persona: PersonaContent = serde_json::from_str(&raw)
                .with_context(|| format!("failed to parse persona {}", path.display()))?;
            validate_persona(&persona)?;
            let stem = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or_default();
            if stem != persona.id {
                return Err(anyhow!(
                    "persona file {} declares id '{}'; filename and id must match",
                    path.display(),
                    persona.id
                ));
            }
            if personas
                .insert(persona.id.clone(), persona.clone())
                .is_some()
            {
                return Err(anyhow!("duplicate persona id '{}'", persona.id));
            }
            hashed_entries.push((persona.id, raw));
        }
    }

    for persona_id in referenced {
        if !personas.contains_key(persona_id) {
            return Err(anyhow!(
                "world content references persona '{}' but {}/{}.json does not exist",
                persona_id,
                dir.display(),
                persona_id
            ));
        }
    }

    hashed_entries.sort_by(|a, b| a.0.cmp(&b.0));
    let combined = hashed_entries
        .iter()
        .map(|(id, raw)| format!("{id}\n{raw}\n"))
        .collect::<String>();
    Ok(LoadedPersonas {
        personas,
        personas_hash: stable_content_hash(&combined),
    })
}

pub(super) fn validate_persona(persona: &PersonaContent) -> anyhow::Result<()> {
    if persona.id.is_empty()
        || !persona
            .id
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
    {
        return Err(anyhow!(
            "persona id '{}' must be lowercase ascii kebab-case",
            persona.id
        ));
    }
    if persona.name.trim().is_empty() || persona.name.len() > 40 {
        return Err(anyhow!(
            "persona '{}' name must be 1-40 characters",
            persona.id
        ));
    }
    if persona.role.trim().is_empty() || persona.role.len() > 120 {
        return Err(anyhow!(
            "persona '{}' role must be 1-120 characters",
            persona.id
        ));
    }
    if persona.persona.trim().is_empty() || persona.persona.len() > MAX_PERSONA_TEXT_CHARS {
        return Err(anyhow!(
            "persona '{}' persona text must be 1-{} characters",
            persona.id,
            MAX_PERSONA_TEXT_CHARS
        ));
    }
    if persona.cognition.canned.is_empty()
        || persona.cognition.canned.len() > MAX_PERSONA_CANNED_LINES
    {
        return Err(anyhow!(
            "persona '{}' must declare 1-{} canned lines",
            persona.id,
            MAX_PERSONA_CANNED_LINES
        ));
    }
    for (index, line) in persona.cognition.canned.iter().enumerate() {
        if line.trim().is_empty() || line.chars().count() > MAX_PERSONA_CANNED_LINE_CHARS {
            return Err(anyhow!(
                "persona '{}' canned line {} must be 1-{} characters",
                persona.id,
                index,
                MAX_PERSONA_CANNED_LINE_CHARS
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shipped_personas_dir() -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("data")
            .join("personas")
    }

    #[test]
    fn shipped_personas_load_and_resolve_world_references() {
        let loaded = load_personas(
            shipped_personas_dir(),
            &["maren".to_string(), "bram".to_string()],
        )
        .expect("shipped personas are valid");
        assert!(loaded.personas.contains_key("maren"));
        assert!(loaded.personas.contains_key("bram"));
        assert!(loaded.personas_hash.starts_with("fnv1a64:"));
        assert!(!loaded.personas["maren"].cognition.canned.is_empty());
    }

    #[test]
    fn persona_hash_is_deterministic() {
        let first = load_personas(shipped_personas_dir(), &[]).expect("personas load");
        let second = load_personas(shipped_personas_dir(), &[]).expect("personas load");
        assert_eq!(first.personas_hash, second.personas_hash);
    }

    #[test]
    fn missing_referenced_persona_fails_boot_validation() {
        let err = load_personas(shipped_personas_dir(), &["nobody".to_string()])
            .expect_err("unknown persona reference must fail");
        assert!(err.to_string().contains("nobody"));
    }

    fn valid_persona() -> PersonaContent {
        PersonaContent {
            id: "test-persona".to_string(),
            name: "Test".to_string(),
            role: "Tester".to_string(),
            persona: "A test persona.".to_string(),
            drives: Vec::new(),
            home_place: None,
            party_policy: None,
            greets_players: false,
            cognition: PersonaCognition {
                tier: "standard".to_string(),
                canned: vec!["Hello.".to_string()],
            },
        }
    }

    #[test]
    fn rejects_bad_persona_ids_and_canned_bounds() {
        let mut persona = valid_persona();
        persona.id = "Bad Id!".to_string();
        assert!(validate_persona(&persona).is_err());

        let mut persona = valid_persona();
        persona.cognition.canned.clear();
        assert!(validate_persona(&persona).is_err());

        let mut persona = valid_persona();
        persona.cognition.canned = vec!["x".repeat(MAX_PERSONA_CANNED_LINE_CHARS + 1)];
        assert!(validate_persona(&persona).is_err());

        assert!(validate_persona(&valid_persona()).is_ok());
    }
}
