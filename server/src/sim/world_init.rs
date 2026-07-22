use std::collections::HashMap;

use bevy_ecs::prelude::*;

use crate::content::WorldContent;
use crate::protocol::{
    ObjectKind, RegionCoordSnapshot, RegionNeighborsSnapshot, RegionRoutingSnapshot,
};
use crate::spatial::{Point, SpatialIndex};
use crate::terrain::{BakedTerrainGrid, TerrainAuthority};

use super::model::{MapBounds, NpcState, Position, SimWorld, WorldObject, SPATIAL_CELL_SIZE};
use super::resources::{generated_ecology_objects, resource_node_for_object};
use super::terrain_authority::{
    terrain_detail_authority_blockers, terrain_detail_authority_decay_consumers,
    terrain_detail_authority_resource_objects, validate_terrain_detail_decay_consumer_targets,
    TerrainDetailAuthority, TerrainDetailResourceObject,
};

impl SimWorld {
    #[cfg(test)]
    pub fn new() -> Self {
        Self::from_content(WorldContent::demo())
    }

    #[cfg(test)]
    pub fn from_content(content: WorldContent) -> Self {
        Self::from_content_with_terrain_detail_authority(content, None)
            .expect("empty terrain detail authority should be valid")
    }

    pub fn from_content_with_terrain_detail_authority(
        content: WorldContent,
        terrain_detail_authority: Option<TerrainDetailAuthority>,
    ) -> Result<Self, String> {
        Self::from_content_with_runtime_authorities(content, terrain_detail_authority, None)
    }

    pub fn from_content_with_runtime_authorities(
        content: WorldContent,
        terrain_detail_authority: Option<TerrainDetailAuthority>,
        chunked_terrain: Option<BakedTerrainGrid>,
    ) -> Result<Self, String> {
        let mut world = World::new();
        let terrain_content = content
            .map
            .terrain
            .clone()
            .expect("validated world content includes terrain");
        let terrain_snapshot = terrain_content.snapshot();
        let units_per_tile = terrain_snapshot.units_per_tile as f32;
        let baked_grid = match chunked_terrain {
            Some(grid) => Some(grid),
            None => BakedTerrainGrid::from_grids(
                &terrain_content.material_grid,
                &terrain_content.vertex_heights,
                &terrain_snapshot.materials,
                (content.map.width / units_per_tile).ceil() as u32,
                (content.map.height / units_per_tile).ceil() as u32,
                terrain_snapshot.vertex_height_precision,
            )?,
        };
        let terrain_detail_blockers = terrain_detail_authority_blockers(
            terrain_detail_authority.as_ref(),
            &terrain_snapshot,
        )?;
        let terrain_detail_resource_objects = terrain_detail_authority_resource_objects(
            terrain_detail_authority.as_ref(),
            &terrain_snapshot,
            content.map.width,
            content.map.height,
        )?;
        let terrain_detail_decay_consumers = terrain_detail_authority_decay_consumers(
            terrain_detail_authority.as_ref(),
            &terrain_snapshot,
            content.map.width,
            content.map.height,
        )?;
        let terrain = TerrainAuthority::with_baked_grid(
            terrain_snapshot.clone(),
            content.map.width,
            content.map.height,
            content.map.safe_zone_radius,
            baked_grid,
        );
        let map = MapBounds {
            width: content.map.width,
            height: content.map.height,
            safe_zone_radius: content.map.safe_zone_radius,
            region: content
                .map
                .region
                .as_ref()
                .map(|region| RegionRoutingSnapshot {
                    schema_version: region.schema_version.clone(),
                    atlas_id: region.atlas_id.clone(),
                    atlas_content_sha256: region.atlas_content_sha256.clone(),
                    region_id: region.region_id.clone(),
                    coord: RegionCoordSnapshot {
                        x: region.coord.x,
                        y: region.coord.y,
                    },
                    tile_origin: RegionCoordSnapshot {
                        x: region.tile_origin.x,
                        y: region.tile_origin.y,
                    },
                    neighbors: RegionNeighborsSnapshot {
                        north: region.neighbors.north.clone(),
                        east: region.neighbors.east.clone(),
                        south: region.neighbors.south.clone(),
                        west: region.neighbors.west.clone(),
                    },
                }),
            terrain_snapshot,
            spawn: Position {
                x: content.spawn.x,
                y: content.spawn.y,
            },
        };

        let npcs = content
            .npcs
            .iter()
            .map(|npc| {
                (
                    npc.id.clone(),
                    NpcState {
                        id: npc.id.clone(),
                        name: npc.name.clone(),
                        persona: npc.persona.clone(),
                        position: Position { x: npc.x, y: npc.y },
                        radius: npc.radius,
                        color: npc.color.clone(),
                        canned: npc.canned.clone(),
                        canned_cursor: 0,
                        speech: None,
                    },
                )
            })
            .collect();

        let mut object_index = SpatialIndex::new(SPATIAL_CELL_SIZE);
        let mut object_entities = HashMap::new();
        let mut max_object_radius: f32 = 0.0;
        for object in content.objects {
            max_object_radius = max_object_radius.max(object.radius);
            let object_id = object.id.clone();
            let entity = spawn_object(
                &mut world,
                &object.id,
                object.kind,
                &object.label,
                object.x,
                object.y,
                object.radius,
            );
            object_index.insert_or_update(
                entity,
                Point {
                    x: object.x,
                    y: object.y,
                },
            );
            object_entities.insert(object_id, entity);
        }
        for object in generated_ecology_objects() {
            max_object_radius = max_object_radius.max(object.radius);
            let object_id = object.id.to_string();
            let entity = spawn_object(
                &mut world,
                object.id,
                object.kind,
                object.label,
                object.x,
                object.y,
                object.radius,
            );
            object_index.insert_or_update(
                entity,
                Point {
                    x: object.x,
                    y: object.y,
                },
            );
            object_entities.insert(object_id, entity);
        }
        for object in terrain_detail_resource_objects {
            max_object_radius = max_object_radius.max(object.radius);
            let object_id = object.id.clone();
            let entity = spawn_terrain_detail_resource_object(&mut world, object);
            let position = *world
                .get::<Position>(entity)
                .expect("spawned terrain detail resource object has position");
            object_index.insert_or_update(
                entity,
                Point {
                    x: position.x,
                    y: position.y,
                },
            );
            object_entities.insert(object_id, entity);
        }
        validate_terrain_detail_decay_consumer_targets(
            &terrain_detail_decay_consumers,
            &object_entities,
        )?;

        Ok(Self {
            world,
            tick: 0,
            map,
            players: HashMap::new(),
            npcs,
            inputs: HashMap::new(),
            interact_latches: HashMap::new(),
            region_handoff_latches: Default::default(),
            player_name_index: HashMap::new(),
            player_index: SpatialIndex::new(SPATIAL_CELL_SIZE),
            object_entities,
            object_index,
            max_object_radius,
            terrain,
            terrain_detail_blockers,
            terrain_detail_decay_consumers,
        })
    }
}

fn spawn_object(
    world: &mut World,
    id: &str,
    kind: ObjectKind,
    label: &str,
    x: f32,
    y: f32,
    radius: f32,
) -> Entity {
    world
        .spawn((
            WorldObject {
                id: id.to_string(),
                kind: kind.clone(),
                label: label.to_string(),
                radius,
                resource_node: resource_node_for_object(kind, id),
            },
            Position { x, y },
        ))
        .id()
}

fn spawn_terrain_detail_resource_object(
    world: &mut World,
    object: TerrainDetailResourceObject,
) -> Entity {
    world
        .spawn((
            WorldObject {
                id: object.id,
                kind: object.kind,
                label: object.label,
                radius: object.radius,
                resource_node: Some(object.resource_node),
            },
            Position {
                x: object.x,
                y: object.y,
            },
        ))
        .id()
}
