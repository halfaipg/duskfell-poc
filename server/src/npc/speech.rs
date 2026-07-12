pub const MAX_SAY_CHARS: usize = 240;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SayTextError {
    Empty,
    TooLong { chars: usize, max: usize },
    InvalidCharacters,
}

impl SayTextError {
    pub fn as_log_reason(&self) -> String {
        match self {
            SayTextError::Empty => "say-text-empty".to_string(),
            SayTextError::TooLong { chars, max } => {
                format!("say-text-too-long chars={chars} max={max}")
            }
            SayTextError::InvalidCharacters => "say-text-invalid-characters".to_string(),
        }
    }
}

/// Validates and normalizes player speech, mirroring the rename discipline:
/// trimmed, bounded, no control characters. Returns the clean text.
pub fn validate_say_text(text: &str) -> Result<String, SayTextError> {
    let clean = text.trim();
    if clean.is_empty() {
        return Err(SayTextError::Empty);
    }
    let chars = clean.chars().count();
    if chars > MAX_SAY_CHARS {
        return Err(SayTextError::TooLong {
            chars,
            max: MAX_SAY_CHARS,
        });
    }
    if clean.chars().any(char::is_control) {
        return Err(SayTextError::InvalidCharacters);
    }
    Ok(clean.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_and_trims_ordinary_speech() {
        assert_eq!(
            validate_say_text("  Who owns the north field?  "),
            Ok("Who owns the north field?".to_string())
        );
    }

    #[test]
    fn rejects_empty_and_whitespace_speech() {
        assert_eq!(validate_say_text(""), Err(SayTextError::Empty));
        assert_eq!(validate_say_text("   "), Err(SayTextError::Empty));
    }

    #[test]
    fn rejects_overlong_speech() {
        let text = "a".repeat(MAX_SAY_CHARS + 1);
        assert_eq!(
            validate_say_text(&text),
            Err(SayTextError::TooLong {
                chars: MAX_SAY_CHARS + 1,
                max: MAX_SAY_CHARS,
            })
        );
    }

    #[test]
    fn rejects_control_characters() {
        assert_eq!(
            validate_say_text("hello\u{0007}"),
            Err(SayTextError::InvalidCharacters)
        );
        assert_eq!(
            validate_say_text("line\nbreak"),
            Err(SayTextError::InvalidCharacters)
        );
    }

    #[test]
    fn accepts_exactly_max_chars() {
        let text = "a".repeat(MAX_SAY_CHARS);
        assert!(validate_say_text(&text).is_ok());
    }
}
