use crate::protocol::ObjectKind;
use crate::terrain::TerrainAuthority;

use super::{Position, OBJECT_SOLID_RADIUS_SCALE, PLAYER_COLLISION_RADIUS};

#[derive(Debug, Clone, Copy)]
pub(super) enum MovementBlocker {
    Circle {
        position: Position,
        radius: f32,
    },
    Aabb {
        position: Position,
        half_width: f32,
        half_height: f32,
    },
}

pub(super) fn player_step_allowed(
    terrain: &TerrainAuthority,
    blockers: &[MovementBlocker],
    from: Position,
    to: Position,
) -> bool {
    terrain.allows_step(from.x, from.y, to.x, to.y)
        && !blockers
            .iter()
            .any(|blocker| object_blocks_player_step(*blocker, from, to))
}

pub(super) fn movement_blocker_contains_player(blocker: MovementBlocker, point: Position) -> bool {
    match blocker {
        MovementBlocker::Circle { position, radius } => {
            distance(point, position) < radius + PLAYER_COLLISION_RADIUS
        }
        MovementBlocker::Aabb {
            position,
            half_width,
            half_height,
        } => aabb_penetration(point, position, half_width, half_height) > 0.0,
    }
}

pub(super) fn object_kind_blocks_movement(kind: &ObjectKind) -> bool {
    match kind {
        ObjectKind::Registrar
        | ObjectKind::Forge
        | ObjectKind::Grove
        | ObjectKind::Ore
        | ObjectKind::Shrine
        | ObjectKind::SaplingTree
        | ObjectKind::Deadwood
        | ObjectKind::FieldCoil
        | ObjectKind::Ruin => true,
        ObjectKind::MyceliumPatch => false,
    }
}

pub(super) fn object_solid_radius(radius: f32) -> f32 {
    radius * OBJECT_SOLID_RADIUS_SCALE
}

pub(super) fn distance(a: Position, b: Position) -> f32 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

fn object_blocks_player_step(blocker: MovementBlocker, from: Position, to: Position) -> bool {
    match blocker {
        MovementBlocker::Circle { position, radius } => {
            let collision_radius = radius + PLAYER_COLLISION_RADIUS;
            let from_distance = distance(from, position);
            let to_distance = distance(to, position);
            to_distance < collision_radius && to_distance < from_distance
        }
        MovementBlocker::Aabb {
            position,
            half_width,
            half_height,
        } => {
            let from_penetration = aabb_penetration(from, position, half_width, half_height);
            let to_penetration = aabb_penetration(to, position, half_width, half_height);
            to_penetration > 0.0 && to_penetration > from_penetration
        }
    }
}

fn aabb_penetration(point: Position, center: Position, half_width: f32, half_height: f32) -> f32 {
    let x_penetration = half_width + PLAYER_COLLISION_RADIUS - (point.x - center.x).abs();
    let y_penetration = half_height + PLAYER_COLLISION_RADIUS - (point.y - center.y).abs();
    x_penetration.min(y_penetration)
}
