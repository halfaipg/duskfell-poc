use bevy_ecs::prelude::Entity;

use crate::protocol::{
    MapSnapshot, ObjectSnapshot, PlayerId, PlayerSnapshot, ResourceKind, ResourceSnapshot,
    SettlementSnapshot, WorldSnapshot,
};

use super::movement::distance;
use super::{point_from_position, Player, Position, ResourceNode, SimWorld, WorldObject};

impl SimWorld {
    pub fn snapshot(&mut self, settlement: SettlementSnapshot) -> WorldSnapshot {
        WorldSnapshot {
            tick: self.tick,
            map: self.map_snapshot(),
            players: self.player_snapshots(None, None, f32::INFINITY),
            objects: self.object_snapshots(None, None, f32::INFINITY),
            settlement,
        }
    }

    pub fn snapshot_for_player(
        &mut self,
        player_id: PlayerId,
        settlement: SettlementSnapshot,
        interest_radius: f32,
    ) -> WorldSnapshot {
        let center = self
            .players
            .get(&player_id)
            .and_then(|entity| self.world.get::<Position>(*entity).copied());
        let player_entities = center.map(|center| {
            self.player_index
                .query_radius(point_from_position(center), interest_radius)
        });
        let object_entities = center.map(|center| {
            self.object_index.query_radius(
                point_from_position(center),
                interest_radius + self.max_object_radius,
            )
        });

        WorldSnapshot {
            tick: self.tick,
            map: self.map_snapshot(),
            players: self.player_snapshots(player_entities.as_deref(), center, interest_radius),
            objects: self.object_snapshots(object_entities.as_deref(), center, interest_radius),
            settlement,
        }
    }

    fn map_snapshot(&self) -> MapSnapshot {
        MapSnapshot {
            width: self.map.width,
            height: self.map.height,
            safe_zone_radius: self.map.safe_zone_radius,
            terrain: self.map.terrain_snapshot.clone(),
        }
    }

    fn player_snapshots(
        &mut self,
        candidates: Option<&[Entity]>,
        center: Option<Position>,
        interest_radius: f32,
    ) -> Vec<PlayerSnapshot> {
        let mut players = Vec::new();
        if let Some(candidates) = candidates {
            for entity in candidates {
                let Some((player, position)) = self
                    .world
                    .get::<Player>(*entity)
                    .zip(self.world.get::<Position>(*entity))
                else {
                    continue;
                };
                players.push(player_snapshot(player, position));
            }
        } else {
            let mut query = self.world.query::<(&Player, &Position)>();
            for (player, position) in query.iter(&self.world) {
                players.push(player_snapshot(player, position));
            }
        }
        if let Some(center) = center {
            players.retain(|player| {
                distance(
                    center,
                    Position {
                        x: player.x,
                        y: player.y,
                    },
                ) <= interest_radius
            });
        }
        players.sort_by_key(|player| player.id);
        players
    }

    fn object_snapshots(
        &mut self,
        candidates: Option<&[Entity]>,
        center: Option<Position>,
        interest_radius: f32,
    ) -> Vec<ObjectSnapshot> {
        let mut objects = Vec::new();
        if let Some(candidates) = candidates {
            for entity in candidates {
                let Some((object, position)) = self
                    .world
                    .get::<WorldObject>(*entity)
                    .zip(self.world.get::<Position>(*entity))
                else {
                    continue;
                };
                objects.push(object_snapshot(object, position));
            }
        } else {
            let mut object_query = self.world.query::<(&WorldObject, &Position)>();
            for (object, position) in object_query.iter(&self.world) {
                objects.push(object_snapshot(object, position));
            }
        }
        if let Some(center) = center {
            objects.retain(|object| {
                distance(
                    center,
                    Position {
                        x: object.x,
                        y: object.y,
                    },
                ) <= interest_radius + object.radius
            });
        }
        objects.sort_by(|a, b| a.id.cmp(&b.id));
        objects
    }
}

fn player_snapshot(player: &Player, position: &Position) -> PlayerSnapshot {
    PlayerSnapshot {
        id: player.id,
        account_subject: player.account_subject.clone(),
        name: player.name.clone(),
        x: position.x,
        y: position.y,
        color: player.color.clone(),
        demo_deeds: player.demo_deeds.clone(),
        resources: ResourceSnapshot {
            wood: player.inventory.resource_total(ResourceKind::Wood),
            ore: player.inventory.resource_total(ResourceKind::Ore),
            stone: player.inventory.resource_total(ResourceKind::Stone),
            charge: player.inventory.resource_total(ResourceKind::Charge),
            deadwood: player.inventory.resource_total(ResourceKind::Deadwood),
            fiber: player.inventory.resource_total(ResourceKind::Fiber),
            mycelium: player.inventory.resource_total(ResourceKind::Mycelium),
            spores: player.inventory.resource_total(ResourceKind::Spores),
            seed: player.inventory.resource_total(ResourceKind::Seed),
        },
        inventory: player.inventory.snapshot(),
    }
}

fn object_snapshot(object: &WorldObject, position: &Position) -> ObjectSnapshot {
    let resources = object
        .resource_node
        .as_ref()
        .map(|node| vec![node.resource_snapshot()])
        .unwrap_or_default();
    let lifecycle = object
        .resource_node
        .as_ref()
        .map(ResourceNode::lifecycle_snapshot);
    ObjectSnapshot {
        id: object.id.clone(),
        kind: object.kind.clone(),
        label: object.label.clone(),
        x: position.x,
        y: position.y,
        radius: object.radius,
        resources,
        lifecycle,
    }
}
