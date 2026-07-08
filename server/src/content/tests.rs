use super::*;

#[test]
fn rejects_duplicate_object_ids() {
    let mut content = valid_minimal_content();
    content.objects.push(ObjectContent {
        id: "registrar".to_string(),
        kind: ObjectKind::Grove,
        label: "Other".to_string(),
        x: 20.0,
        y: 20.0,
        radius: 5.0,
    });

    assert!(content.validate().is_err());
}

#[test]
fn rejects_missing_required_registrar() {
    let mut content = valid_minimal_content();
    content.objects.retain(|object| object.id != "registrar");

    let err = content
        .validate()
        .expect_err("registrar object is required");

    assert!(err.to_string().contains("object id 'registrar'"));
}

#[test]
fn rejects_registrar_id_with_wrong_kind() {
    let mut content = valid_minimal_content();
    content.objects[0].kind = ObjectKind::Grove;

    let err = content
        .validate()
        .expect_err("registrar object must use registrar kind");

    assert!(err.to_string().contains("kind 'registrar'"));
}

#[test]
fn rejects_missing_required_forge() {
    let mut content = valid_minimal_content();
    content.objects.retain(|object| object.id != "field-forge");

    let err = content
        .validate()
        .expect_err("field forge object is required");

    assert!(err.to_string().contains("object id 'field-forge'"));
}

#[test]
fn rejects_forge_id_with_wrong_kind() {
    let mut content = valid_minimal_content();
    let forge = content
        .objects
        .iter_mut()
        .find(|object| object.id == "field-forge")
        .expect("valid fixture has forge");
    forge.kind = ObjectKind::Ore;

    let err = content
        .validate()
        .expect_err("field forge object must use forge kind");

    assert!(err.to_string().contains("kind 'forge'"));
}

#[test]
fn rejects_safe_zone_larger_than_map_bounds() {
    let mut content = valid_minimal_content();
    content.map.safe_zone_radius = 60.0;

    let err = content
        .validate()
        .expect_err("safe zone must fit inside map bounds");

    assert!(err.to_string().contains("safeZoneRadius"));
}

#[test]
fn rejects_missing_terrain_profile() {
    let mut content = valid_minimal_content();
    content.map.terrain = None;

    let err = content.validate().expect_err("terrain profile is required");

    assert!(err.to_string().contains("map.terrain"));
}

#[test]
fn rejects_terrain_projection_drift() {
    let mut content = valid_minimal_content();
    content
        .map
        .terrain
        .as_mut()
        .expect("fixture has terrain")
        .tile_height = 32;

    let err = content
        .validate()
        .expect_err("terrain tile dimensions must stay in projection contract");

    assert!(err.to_string().contains("tile dimensions"));
}

#[test]
fn rejects_unsupported_terrain_material() {
    let mut content = valid_minimal_content();
    content
        .map
        .terrain
        .as_mut()
        .expect("fixture has terrain")
        .materials[0] = "lava".to_string();

    let err = content
        .validate()
        .expect_err("terrain materials are canonical");

    assert!(err.to_string().contains("unsupported material"));
}

#[test]
fn rejects_object_footprint_outside_map_bounds() {
    let mut content = valid_minimal_content();
    content.objects[0].x = 3.0;
    content.objects[0].radius = 5.0;

    let err = content
        .validate()
        .expect_err("object footprint must fit inside map bounds");

    assert!(err.to_string().contains("footprint radius"));
}

#[test]
fn rejects_wrong_schema_version() {
    let mut content = WorldContent::demo();
    content.schema_version = "other-version".to_string();

    assert!(content.validate().is_err());
}

#[test]
fn rejects_too_many_objects() {
    let content = WorldContent::demo();

    let err = content
        .validate_with_limits(1)
        .expect_err("object cap should reject demo content");

    assert!(err.to_string().contains("MAX_CONTENT_OBJECTS"));
}

#[test]
fn stable_hash_is_deterministic() {
    assert_eq!(stable_content_hash("abc"), stable_content_hash("abc"));
    assert_ne!(stable_content_hash("abc"), stable_content_hash("abcd"));
    assert!(stable_content_hash("abc").starts_with("fnv1a64:"));
}

fn valid_minimal_content() -> WorldContent {
    WorldContent {
        schema_version: WORLD_SCHEMA_VERSION.to_string(),
        map: MapContent {
            width: 100.0,
            height: 100.0,
            safe_zone_radius: 20.0,
            terrain: Some(valid_terrain()),
        },
        spawn: SpawnContent { x: 20.0, y: 20.0 },
        objects: vec![
            ObjectContent {
                id: "registrar".to_string(),
                kind: ObjectKind::Registrar,
                label: "Title Office".to_string(),
                x: 10.0,
                y: 10.0,
                radius: 5.0,
            },
            ObjectContent {
                id: "field-forge".to_string(),
                kind: ObjectKind::Forge,
                label: "Field Forge".to_string(),
                x: 30.0,
                y: 30.0,
                radius: 5.0,
            },
        ],
    }
}

fn valid_terrain() -> TerrainContent {
    TerrainContent {
        profile: TERRAIN_PROFILE.to_string(),
        seed: 7341,
        units_per_tile: TERRAIN_UNITS_PER_TILE,
        tile_width: TERRAIN_TILE_WIDTH,
        tile_height: TERRAIN_TILE_HEIGHT,
        height_scale: 6.0,
        min_elevation: -1,
        max_elevation: 4,
        water_level: -1,
        max_walkable_step: 1,
        materials: TERRAIN_MATERIALS
            .iter()
            .map(|material| material.to_string())
            .collect(),
    }
}
