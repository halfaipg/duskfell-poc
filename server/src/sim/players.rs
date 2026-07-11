use uuid::Uuid;

use crate::player_identity::{
    color_for, player_name_key, validate_player_name, PlayerNameError, PLAYER_NAME_MAX_CHARS,
};
use crate::protocol::PlayerId;
use crate::spatial::Point;

use super::inventory::PlayerInventory;
use super::model::{Player, PlayerInput, Position, SimWorld, Velocity};

impl SimWorld {
    #[cfg(test)]
    pub fn add_player(&mut self, id: PlayerId) {
        self.add_player_with_identity(id, None, None)
            .expect("default player name should be valid");
    }

    #[cfg(test)]
    pub fn add_player_with_display_name(
        &mut self,
        id: PlayerId,
        display_name: Option<String>,
    ) -> Result<(), PlayerNameError> {
        self.add_player_with_identity(id, display_name, None)
    }

    pub fn add_player_with_identity(
        &mut self,
        id: PlayerId,
        display_name: Option<String>,
        account_subject: Option<String>,
    ) -> Result<(), PlayerNameError> {
        let color = color_for(id);
        let spawn_position = self.spawn_position_for_next_player();
        let name = match display_name {
            Some(name) => {
                let clean_name = validate_player_name(&name)?;
                if !self.is_player_name_available(&clean_name, Some(id)) {
                    return Err(PlayerNameError::Taken);
                }
                clean_name
            }
            None => self.default_player_name(id),
        };
        let name_key = player_name_key(&name);
        let entity = self
            .world
            .spawn((
                Player {
                    id,
                    account_subject,
                    name: name.clone(),
                    color,
                    demo_deeds: Vec::new(),
                    inventory: PlayerInventory::default(),
                    speech: None,
                },
                Position {
                    x: spawn_position.x,
                    y: spawn_position.y,
                },
                Velocity::default(),
            ))
            .id();
        self.player_name_index.insert(name_key, id);
        self.players.insert(id, entity);
        self.inputs.insert(id, PlayerInput::default());
        self.interact_latches.insert(id, false);
        self.player_index.insert_or_update(
            entity,
            Point {
                x: spawn_position.x,
                y: spawn_position.y,
            },
        );
        Ok(())
    }

    pub fn remove_player(&mut self, id: PlayerId) {
        if let Some(entity) = self.players.remove(&id) {
            if let Some(player) = self.world.get::<Player>(entity) {
                self.player_name_index
                    .remove(&player_name_key(&player.name));
            }
            self.player_index.remove(entity);
            let _ = self.world.despawn(entity);
        }
        self.inputs.remove(&id);
        self.interact_latches.remove(&id);
    }

    pub fn rename_player(
        &mut self,
        id: PlayerId,
        name: &str,
    ) -> Result<Option<String>, PlayerNameError> {
        let clean_name = validate_player_name(name)?;
        let Some(entity) = self.players.get(&id).copied() else {
            return Ok(None);
        };
        if !self.is_player_name_available(&clean_name, Some(id)) {
            return Err(PlayerNameError::Taken);
        }
        let Some(player) = self.world.get::<Player>(entity) else {
            return Ok(None);
        };
        let old_key = player_name_key(&player.name);
        let new_key = player_name_key(&clean_name);
        if old_key != new_key {
            self.player_name_index.remove(&old_key);
            self.player_name_index.insert(new_key, id);
        }
        if let Some(mut player) = self.world.get_mut::<Player>(entity) {
            player.name = clean_name.clone();
            return Ok(Some(clean_name));
        }
        Ok(None)
    }

    // UO-style overhead speech: sanitize, clamp, and stamp an expiry that
    // scales with message length so long lines linger a little longer
    pub fn player_say(&mut self, id: PlayerId, text: &str) -> bool {
        const SPEECH_MAX_CHARS: usize = 96;
        const TICKS_PER_SECOND: u64 = 20;
        let clean: String = text
            .chars()
            .filter(|c| !c.is_control())
            .collect::<String>()
            .trim()
            .chars()
            .take(SPEECH_MAX_CHARS)
            .collect();
        if clean.is_empty() {
            return false;
        }
        let Some(entity) = self.players.get(&id).copied() else {
            return false;
        };
        let duration_ticks = (TICKS_PER_SECOND * 3 + (clean.chars().count() as u64) / 2)
            .min(TICKS_PER_SECOND * 10);
        let until_tick = self.tick + duration_ticks;
        let Some(mut player) = self.world.get_mut::<Player>(entity) else {
            return false;
        };
        player.speech = Some(super::model::PlayerSpeech {
            text: clean,
            until_tick,
        });
        true
    }

    pub fn is_player_name_available(&self, name: &str, owner: Option<PlayerId>) -> bool {
        match self.player_name_index.get(&player_name_key(name)) {
            Some(existing_owner) => Some(*existing_owner) == owner,
            None => true,
        }
    }

    pub fn set_input(&mut self, id: PlayerId, input: PlayerInput) {
        if self.players.contains_key(&id) {
            self.inputs.insert(id, input);
        }
    }

    fn default_player_name(&self, id: PlayerId) -> String {
        let base = format!("Wayfarer-{}", &id.to_string()[..4]);
        if self.is_player_name_available(&base, Some(id)) {
            return base;
        }

        for suffix in 2..1000 {
            let candidate = format!("{base}-{suffix}");
            if candidate.chars().count() <= PLAYER_NAME_MAX_CHARS
                && self.is_player_name_available(&candidate, Some(id))
            {
                return candidate;
            }
        }

        format!("Wayfarer-{}", &Uuid::new_v4().to_string()[..4])
    }
}
