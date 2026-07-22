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
fn rejects_duplicate_npc_ids() {
    let mut content = valid_minimal_content();
    let npc = valid_npc();
    content.npcs.extend([npc.clone(), npc]);

    let err = content.validate().expect_err("NPC ids must be unique");
    assert!(err.to_string().contains("duplicate npc id"));
}

#[test]
fn rejects_invalid_npc_content() {
    let mut content = valid_minimal_content();
    let mut npc = valid_npc();
    npc.canned.clear();
    content.npcs.push(npc);

    let err = content
        .validate()
        .expect_err("NPCs require a fallback line");
    assert!(err.to_string().contains("canned"));
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
fn terrain_visual_details_default_on_and_remain_independent_from_authority() {
    let mut terrain = valid_terrain();
    terrain.detail_authority_enabled = Some(false);

    let snapshot = terrain.snapshot();
    assert!(!snapshot.detail_authority_enabled);
    assert!(snapshot.visual_detail_enabled);

    terrain.visual_detail_enabled = Some(false);
    assert!(!terrain.snapshot().visual_detail_enabled);
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
fn validates_exclusive_hash_pinned_chunk_authority() {
    let mut content = valid_minimal_content();
    let terrain = content.map.terrain.as_mut().expect("terrain");
    terrain.vertex_height_precision = 1000;
    terrain.chunk_authority = Some(ChunkAuthorityContent {
        schema_version: "duskfell-world-chunk-index-v1".to_string(),
        index_sha256: "a".repeat(64),
        chunk_count: 1,
        chunk_tiles: 2,
        apron_tiles: 1,
        vertex_height_precision: 1000,
        total_bytes: 1024,
    });
    content
        .validate()
        .expect("bounded chunk authority is valid");

    let terrain = content.map.terrain.as_mut().expect("terrain");
    terrain.material_grid = vec!["00".to_string(), "00".to_string()];
    terrain.vertex_heights = vec![vec![0; 3]; 3];
    let error = content
        .validate()
        .expect_err("chunk and monolithic authority must be mutually exclusive");
    assert!(error
        .to_string()
        .contains("either chunkAuthority or monolithic"));
}

#[test]
fn validates_region_identity_origin_and_neighbors() {
    let mut content = valid_minimal_content();
    let terrain = content.map.terrain.as_mut().expect("terrain");
    terrain.vertex_height_precision = 1000;
    terrain.chunk_authority = Some(ChunkAuthorityContent {
        schema_version: "duskfell-world-chunk-index-v1".to_string(),
        index_sha256: "a".repeat(64),
        chunk_count: 1,
        chunk_tiles: 2,
        apron_tiles: 1,
        vertex_height_precision: 1000,
        total_bytes: 1024,
    });
    content.map.region = Some(RegionRoutingContent {
        schema_version: "duskfell-region-routing-v1".to_string(),
        atlas_id: "duskfell-continent".to_string(),
        atlas_content_sha256: "b".repeat(64),
        region_id: "duskfell-continent-r2-3".to_string(),
        coord: RegionCoordContent { x: 2, y: 3 },
        tile_origin: RegionCoordContent { x: 4, y: 6 },
        neighbors: RegionNeighborsContent {
            north: Some("duskfell-continent-r2-2".to_string()),
            east: Some("duskfell-continent-r3-3".to_string()),
            south: Some("duskfell-continent-r2-4".to_string()),
            west: Some("duskfell-continent-r1-3".to_string()),
        },
    });
    content
        .validate()
        .expect("coherent region routing is valid");

    content.map.region.as_mut().unwrap().tile_origin.x = 5;
    let error = content
        .validate()
        .expect_err("drifted global origin must fail");
    assert!(error.to_string().contains("tileOrigin"));
}

#[test]
fn validates_bounded_terrain_trails() {
    let mut content = valid_minimal_content();
    let terrain = content.map.terrain.as_mut().expect("terrain");
    terrain.trails.push(TrailContent {
        id: "old-road".to_string(),
        label: "Old Road".to_string(),
        kind: "road".to_string(),
        width_tiles: 1.2,
        points: vec![
            TrailPointContent { x: 0.5, y: 0.5 },
            TrailPointContent { x: 1.5, y: 1.5 },
        ],
    });
    content.validate().expect("bounded trail should be valid");

    let terrain = content.map.terrain.as_mut().expect("terrain");
    terrain.trails[0].points[1].x = 3.0;
    let err = content
        .validate()
        .expect_err("out-of-bounds trail must fail");
    assert!(err.to_string().contains("inside terrain bounds"));
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
            region: None,
            terrain: Some(valid_terrain()),
        },
        spawn: SpawnContent { x: 20.0, y: 20.0 },
        npcs: Vec::new(),
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

fn valid_npc() -> NpcContent {
    NpcContent {
        id: "maren".to_string(),
        name: "Maren".to_string(),
        role: "registrar".to_string(),
        persona: "Careful with every word.".to_string(),
        drives: vec!["Protect the ledger".to_string()],
        canned: vec!["The ledger is open.".to_string()],
        x: 20.0,
        y: 20.0,
        radius: 18.0,
        color: "#766451".to_string(),
    }
}

fn valid_terrain() -> TerrainContent {
    TerrainContent {
        profile: TERRAIN_PROFILE.to_string(),
        seed: 7341,
        detail_authority_enabled: None,
        visual_detail_enabled: None,
        units_per_tile: TERRAIN_UNITS_PER_TILE,
        tile_width: TERRAIN_TILE_WIDTH,
        tile_height: TERRAIN_TILE_HEIGHT,
        height_scale: 6.0,
        min_elevation: -1,
        max_elevation: 4,
        water_level: -1,
        max_walkable_step: 1,
        vertex_height_precision: 1,
        materials: TERRAIN_MATERIALS
            .iter()
            .map(|material| material.to_string())
            .collect(),
        material_grid: Vec::new(),
        vertex_heights: Vec::new(),
        chunk_authority: None,
        trails: Vec::new(),
    }
}
