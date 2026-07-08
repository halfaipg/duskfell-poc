use crate::protocol::PlayerId;

pub const PLAYER_NAME_MAX_CHARS: usize = 20;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlayerNameError {
    Empty,
    TooLong { max: usize },
    InvalidCharacters,
    Taken,
}

impl PlayerNameError {
    pub fn as_log_reason(&self) -> String {
        match self {
            Self::Empty => "invalid-player-name empty".to_string(),
            Self::TooLong { max } => format!("invalid-player-name too-long max={max}"),
            Self::InvalidCharacters => "invalid-player-name invalid-characters".to_string(),
            Self::Taken => "invalid-player-name already-active".to_string(),
        }
    }
}

pub(crate) fn player_name_key(name: &str) -> String {
    name.to_ascii_lowercase()
}

pub fn validate_player_name(name: &str) -> Result<String, PlayerNameError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(PlayerNameError::Empty);
    }
    if trimmed.chars().count() > PLAYER_NAME_MAX_CHARS {
        return Err(PlayerNameError::TooLong {
            max: PLAYER_NAME_MAX_CHARS,
        });
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(PlayerNameError::InvalidCharacters);
    }

    Ok(trimmed.to_string())
}

pub(crate) fn color_for(id: PlayerId) -> String {
    let bytes = id.as_bytes();
    let red = 72u8.saturating_add(bytes[0] % 112);
    let green = 84u8.saturating_add(bytes[7] % 112);
    let blue = 96u8.saturating_add(bytes[15] % 112);
    format!("#{red:02x}{green:02x}{blue:02x}")
}
