use super::{
    distance, movement_blocker_contains_player, object_kind_blocks_movement, object_solid_radius,
    MovementBlocker, Position, SimWorld, WorldObject, SPAWN_PLAYER_SEPARATION, SPAWN_SAFE_MARGIN,
    SPAWN_SLOT_BASE_RADIUS, SPAWN_SLOT_COUNT, SPAWN_SLOT_MAX_RINGS, SPAWN_SLOT_RING_STEP,
};

impl SimWorld {
    pub(super) fn spawn_position_for_next_player(&mut self) -> Position {
        let blockers = self.movement_blockers();
        let existing_players = self.player_positions();
        let start_index = self.players.len();
        for ring in 0..SPAWN_SLOT_MAX_RINGS {
            let radius = SPAWN_SLOT_BASE_RADIUS + ring as f32 * SPAWN_SLOT_RING_STEP;
            for step in 0..SPAWN_SLOT_COUNT {
                let slot = (start_index + step * 5 + ring * 3) % SPAWN_SLOT_COUNT;
                let angle = (slot as f32 / SPAWN_SLOT_COUNT as f32) * std::f32::consts::TAU;
                let candidate = Position {
                    x: (self.map.spawn.x + angle.cos() * radius)
                        .clamp(SPAWN_SAFE_MARGIN, self.map.width - SPAWN_SAFE_MARGIN),
                    y: (self.map.spawn.y + angle.sin() * radius)
                        .clamp(SPAWN_SAFE_MARGIN, self.map.height - SPAWN_SAFE_MARGIN),
                };
                if self.spawn_position_is_valid(candidate, &blockers, &existing_players) {
                    return candidate;
                }
            }
        }
        self.map.spawn
    }

    fn player_positions(&self) -> Vec<Position> {
        self.players
            .values()
            .filter_map(|entity| self.world.get::<Position>(*entity).copied())
            .collect()
    }

    fn spawn_position_is_valid(
        &self,
        candidate: Position,
        blockers: &[MovementBlocker],
        existing_players: &[Position],
    ) -> bool {
        if !self.terrain.is_walkable_at_world(candidate.x, candidate.y) {
            return false;
        }
        if (self.terrain.height_at_world(candidate.x, candidate.y)
            - self
                .terrain
                .height_at_world(self.map.spawn.x, self.map.spawn.y))
        .abs()
            > self.map.terrain_snapshot.max_walkable_step as f32
        {
            return false;
        }
        if blockers
            .iter()
            .any(|blocker| movement_blocker_contains_player(*blocker, candidate))
        {
            return false;
        }
        !existing_players
            .iter()
            .any(|position| distance(*position, candidate) < SPAWN_PLAYER_SEPARATION)
    }

    pub(super) fn movement_blockers(&mut self) -> Vec<MovementBlocker> {
        let mut blockers = self.terrain_detail_blockers.clone();
        let mut query = self.world.query::<(&WorldObject, &Position)>();
        for (object, position) in query.iter(&self.world) {
            if object_kind_blocks_movement(&object.kind) {
                blockers.push(MovementBlocker::Circle {
                    position: *position,
                    radius: object_solid_radius(object.radius),
                });
            }
        }
        blockers
    }
}
