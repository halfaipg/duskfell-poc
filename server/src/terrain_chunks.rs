use std::collections::HashSet;
use std::fs;
use std::path::Path;

use anyhow::{anyhow, Context};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::content::ChunkAuthorityContent;
use crate::terrain::BakedTerrainGrid;

const MAX_INDEX_BYTES: u64 = 256 * 1024;
const MAX_CHUNK_BYTES: u64 = 4 * 1024 * 1024;
const MAX_REGION_TILES: u64 = 256 * 1024;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
struct Rect {
    x: u32,
    y: u32,
    cols: u32,
    rows: u32,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Hash)]
struct Coord {
    x: u32,
    y: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkIndex {
    schema: String,
    world: String,
    dimensions: ChunkDimensions,
    chunk_tiles: u32,
    apron_tiles: u32,
    vertex_height_precision: u32,
    grid: ChunkGrid,
    water_authority: Option<WaterAuthorityIndex>,
    chunks: Vec<ChunkEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WaterAuthorityIndex {
    schema: String,
    samples_per_tile: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkDimensions {
    cols: u32,
    rows: u32,
    units_per_tile: u32,
}

#[derive(Debug, Deserialize)]
struct ChunkGrid {
    cols: u32,
    rows: u32,
}

#[derive(Debug, Deserialize)]
struct ChunkEntry {
    id: String,
    coord: Coord,
    core: Rect,
    sample: Rect,
    path: String,
    sha256: String,
    bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerrainChunk {
    schema: String,
    world: String,
    id: String,
    coord: Coord,
    core: Rect,
    sample: Rect,
    units_per_tile: u32,
    vertex_height_precision: u32,
    vertex_heights: Vec<Vec<i32>>,
    material_grid: Vec<String>,
    water_authority: Option<ChunkWaterAuthority>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkWaterAuthority {
    schema: String,
    algorithm: String,
    samples_per_tile: u32,
    units_per_tile: u32,
    height_encoding: String,
    height_scale: f32,
    sample: Rect,
    wet_mask: Vec<Vec<f32>>,
    surface_height: Vec<Vec<f32>>,
    depth: Vec<Vec<f32>>,
    flow_direction_d8: Vec<Vec<i8>>,
    flow_strength: Vec<Vec<f32>>,
}

pub(crate) fn load_chunked_terrain_grid(
    index_path: &Path,
    authority: &ChunkAuthorityContent,
    materials: &[String],
    cols: u32,
    rows: u32,
    units_per_tile: u32,
    min_elevation: i32,
    max_elevation: i32,
) -> anyhow::Result<BakedTerrainGrid> {
    if u64::from(cols) * u64::from(rows) > MAX_REGION_TILES {
        return Err(anyhow!(
            "chunked terrain region contains more than {MAX_REGION_TILES} tiles; route it as multiple server regions"
        ));
    }
    let index_bytes = read_bounded(index_path, MAX_INDEX_BYTES, "terrain chunk index")?;
    verify_sha256(&index_bytes, &authority.index_sha256, "terrain chunk index")?;
    let index: ChunkIndex = serde_json::from_slice(&index_bytes).with_context(|| {
        format!(
            "failed to parse terrain chunk index {}",
            index_path.display()
        )
    })?;
    validate_index(&index, authority, cols, rows, units_per_tile)?;

    let package_root = index_path
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| anyhow!("terrain chunk index must be inside a chunks directory"))?;
    let mut material_rows = vec![vec![None; cols as usize]; rows as usize];
    let mut vertices = vec![vec![None; cols as usize + 1]; rows as usize + 1];
    let mut water_depth_rows = index
        .water_authority
        .as_ref()
        .map(|_| vec![vec![None; cols as usize]; rows as usize]);
    let mut seen_coords = HashSet::new();
    let mut total_bytes = 0_u64;
    let min_fixed = i64::from(min_elevation) * i64::from(authority.vertex_height_precision);
    let max_fixed = i64::from(max_elevation) * i64::from(authority.vertex_height_precision);

    for entry in &index.chunks {
        validate_entry(entry, &index, cols, rows, &mut seen_coords)?;
        total_bytes = total_bytes
            .checked_add(entry.bytes)
            .ok_or_else(|| anyhow!("terrain chunk byte total overflowed"))?;
        if total_bytes > authority.total_bytes {
            return Err(anyhow!("terrain chunk files exceed pinned totalBytes"));
        }
        let expected_path = format!("chunks/chunk-{}-{}.json", entry.coord.x, entry.coord.y);
        if entry.path != expected_path {
            return Err(anyhow!("terrain chunk {} path is unsafe", entry.id));
        }
        let chunk_path = package_root.join(&entry.path);
        let bytes = read_bounded(
            &chunk_path,
            MAX_CHUNK_BYTES.min(entry.bytes),
            "terrain chunk",
        )?;
        if bytes.len() as u64 != entry.bytes {
            return Err(anyhow!(
                "terrain chunk {} byte count does not match index",
                entry.id
            ));
        }
        verify_sha256(
            &bytes,
            &entry.sha256,
            &format!("terrain chunk {}", entry.id),
        )?;
        let chunk: TerrainChunk = serde_json::from_slice(&bytes)
            .with_context(|| format!("failed to parse terrain chunk {}", chunk_path.display()))?;
        validate_chunk(&chunk, entry, &index, min_fixed, max_fixed)?;
        merge_chunk(
            &chunk,
            &mut material_rows,
            &mut vertices,
            water_depth_rows.as_mut().map(|rows| rows.as_mut_slice()),
        )?;
    }
    if total_bytes != authority.total_bytes {
        return Err(anyhow!(
            "terrain chunk files do not match pinned totalBytes"
        ));
    }
    if material_rows.iter().flatten().any(Option::is_none)
        || vertices.iter().flatten().any(Option::is_none)
        || water_depth_rows
            .as_ref()
            .is_some_and(|depths| depths.iter().flatten().any(Option::is_none))
    {
        return Err(anyhow!(
            "terrain chunks do not cover the complete server region"
        ));
    }
    let material_grid = material_rows
        .into_iter()
        .map(|row| row.into_iter().map(Option::unwrap).collect())
        .collect::<Vec<String>>();
    let vertex_heights = vertices
        .into_iter()
        .map(|row| row.into_iter().map(Option::unwrap).collect())
        .collect::<Vec<Vec<i32>>>();
    let water_depths = water_depth_rows.map(|rows| {
        rows.into_iter()
            .map(|row| row.into_iter().map(Option::unwrap).collect())
            .collect::<Vec<Vec<f32>>>()
    });
    BakedTerrainGrid::from_grids_with_water_depths(
        &material_grid,
        &vertex_heights,
        materials,
        cols,
        rows,
        authority.vertex_height_precision,
        water_depths.as_deref(),
    )
    .map_err(|error| anyhow!(error))?
    .ok_or_else(|| anyhow!("terrain chunks unexpectedly produced an empty authority grid"))
}

fn validate_index(
    index: &ChunkIndex,
    authority: &ChunkAuthorityContent,
    cols: u32,
    rows: u32,
    units_per_tile: u32,
) -> anyhow::Result<()> {
    if index.schema != authority.schema_version || index.world.is_empty() {
        return Err(anyhow!("terrain chunk index identity is invalid"));
    }
    if index.dimensions.cols != cols
        || index.dimensions.rows != rows
        || index.dimensions.units_per_tile != units_per_tile
    {
        return Err(anyhow!(
            "terrain chunk index dimensions do not match server content"
        ));
    }
    if index.chunk_tiles != authority.chunk_tiles
        || index.apron_tiles != authority.apron_tiles
        || index.vertex_height_precision != authority.vertex_height_precision
    {
        return Err(anyhow!(
            "terrain chunk index geometry does not match server content"
        ));
    }
    if let Some(water) = &index.water_authority {
        if water.schema != "duskfell-water-authority-v1"
            || water.samples_per_tile == 0
            || water.samples_per_tile > 8
        {
            return Err(anyhow!("terrain chunk water authority index is invalid"));
        }
    }
    let expected_grid = ChunkGrid {
        cols: cols.div_ceil(index.chunk_tiles),
        rows: rows.div_ceil(index.chunk_tiles),
    };
    if index.grid.cols != expected_grid.cols || index.grid.rows != expected_grid.rows {
        return Err(anyhow!(
            "terrain chunk index grid does not cover server content"
        ));
    }
    if index.chunks.len() != authority.chunk_count as usize {
        return Err(anyhow!(
            "terrain chunk index count does not match server content"
        ));
    }
    Ok(())
}

fn validate_entry(
    entry: &ChunkEntry,
    index: &ChunkIndex,
    cols: u32,
    rows: u32,
    seen_coords: &mut HashSet<Coord>,
) -> anyhow::Result<()> {
    if !seen_coords.insert(entry.coord) {
        return Err(anyhow!(
            "terrain chunk index contains duplicate coordinates"
        ));
    }
    if entry.coord.x >= index.grid.cols || entry.coord.y >= index.grid.rows {
        return Err(anyhow!(
            "terrain chunk {} coordinate is outside the grid",
            entry.id
        ));
    }
    let expected_id = format!("{}-{}", entry.coord.x, entry.coord.y);
    let core = Rect {
        x: entry.coord.x * index.chunk_tiles,
        y: entry.coord.y * index.chunk_tiles,
        cols: index
            .chunk_tiles
            .min(cols - entry.coord.x * index.chunk_tiles),
        rows: index
            .chunk_tiles
            .min(rows - entry.coord.y * index.chunk_tiles),
    };
    let sample = Rect {
        x: core.x.saturating_sub(index.apron_tiles),
        y: core.y.saturating_sub(index.apron_tiles),
        cols: (core.x + core.cols + index.apron_tiles).min(cols)
            - core.x.saturating_sub(index.apron_tiles),
        rows: (core.y + core.rows + index.apron_tiles).min(rows)
            - core.y.saturating_sub(index.apron_tiles),
    };
    if entry.id != expected_id || entry.core != core || entry.sample != sample {
        return Err(anyhow!(
            "terrain chunk {} bounds drift from its index coordinate",
            entry.id
        ));
    }
    if entry.bytes == 0 || entry.bytes > MAX_CHUNK_BYTES || !valid_sha256(&entry.sha256) {
        return Err(anyhow!(
            "terrain chunk {} integrity metadata is invalid",
            entry.id
        ));
    }
    Ok(())
}

fn validate_chunk(
    chunk: &TerrainChunk,
    entry: &ChunkEntry,
    index: &ChunkIndex,
    min_fixed: i64,
    max_fixed: i64,
) -> anyhow::Result<()> {
    if chunk.schema != "duskfell-world-chunk-v1"
        || chunk.world != index.world
        || chunk.id != entry.id
        || chunk.coord != entry.coord
        || chunk.core != entry.core
        || chunk.sample != entry.sample
    {
        return Err(anyhow!(
            "terrain chunk {} identity or bounds drift from index",
            entry.id
        ));
    }
    if chunk.units_per_tile != index.dimensions.units_per_tile
        || chunk.vertex_height_precision != index.vertex_height_precision
    {
        return Err(anyhow!(
            "terrain chunk {} projection or precision drifts from index",
            entry.id
        ));
    }
    if chunk.material_grid.len() != entry.sample.rows as usize
        || chunk
            .material_grid
            .iter()
            .any(|row| row.chars().count() != entry.sample.cols as usize)
    {
        return Err(anyhow!(
            "terrain chunk {} material dimensions are invalid",
            entry.id
        ));
    }
    if chunk.vertex_heights.len() != entry.sample.rows as usize + 1
        || chunk
            .vertex_heights
            .iter()
            .any(|row| row.len() != entry.sample.cols as usize + 1)
    {
        return Err(anyhow!(
            "terrain chunk {} height dimensions are invalid",
            entry.id
        ));
    }
    if chunk
        .vertex_heights
        .iter()
        .flatten()
        .any(|height| i64::from(*height) < min_fixed || i64::from(*height) > max_fixed)
    {
        return Err(anyhow!(
            "terrain chunk {} contains out-of-range heights",
            entry.id
        ));
    }
    validate_water_authority_chunk(chunk, entry, index)?;
    Ok(())
}

fn validate_water_authority_chunk(
    chunk: &TerrainChunk,
    entry: &ChunkEntry,
    index: &ChunkIndex,
) -> anyhow::Result<()> {
    let Some(contract) = &index.water_authority else {
        if chunk.water_authority.is_some() {
            return Err(anyhow!("terrain chunk contains unindexed water authority"));
        }
        return Ok(());
    };
    let water = chunk
        .water_authority
        .as_ref()
        .ok_or_else(|| anyhow!("terrain chunk {} is missing water authority", entry.id))?;
    let samples = contract.samples_per_tile;
    let expected_sample = Rect {
        x: entry.sample.x * samples,
        y: entry.sample.y * samples,
        cols: entry.sample.cols * samples,
        rows: entry.sample.rows * samples,
    };
    if water.schema != contract.schema
        || water.algorithm != "priority-flood-surface-depth-flow-v1"
        || water.samples_per_tile != samples
        || water.units_per_tile != index.dimensions.units_per_tile
        || water.height_encoding != "world-elevation-levels-v1"
        || (water.height_scale - 2.0).abs() > f32::EPSILON
        || water.sample != expected_sample
    {
        return Err(anyhow!(
            "terrain chunk {} water authority contract is invalid",
            entry.id
        ));
    }
    let shape = |values: &[Vec<f32>], predicate: fn(f32) -> bool| {
        values.len() == expected_sample.rows as usize
            && values.iter().all(|row| {
                row.len() == expected_sample.cols as usize && row.iter().copied().all(predicate)
            })
    };
    let unit = |value: f32| value.is_finite() && (0.0..=1.0).contains(&value);
    let nonnegative = |value: f32| value.is_finite() && value >= 0.0;
    if !shape(&water.wet_mask, unit)
        || !shape(&water.surface_height, nonnegative)
        || !shape(&water.depth, nonnegative)
        || !shape(&water.flow_strength, unit)
        || water.flow_direction_d8.len() != expected_sample.rows as usize
        || water.flow_direction_d8.iter().any(|row| {
            row.len() != expected_sample.cols as usize
                || row.iter().any(|value| !(-1..=7).contains(value))
        })
    {
        return Err(anyhow!(
            "terrain chunk {} water authority fields are invalid",
            entry.id
        ));
    }
    Ok(())
}

fn merge_chunk(
    chunk: &TerrainChunk,
    materials: &mut [Vec<Option<char>>],
    vertices: &mut [Vec<Option<i32>>],
    water_depths: Option<&mut [Vec<Option<f32>>]>,
) -> anyhow::Result<()> {
    let offset_x = (chunk.core.x - chunk.sample.x) as usize;
    let offset_y = (chunk.core.y - chunk.sample.y) as usize;
    for local_y in 0..chunk.core.rows as usize {
        let source = chunk.material_grid[offset_y + local_y]
            .chars()
            .collect::<Vec<char>>();
        for local_x in 0..chunk.core.cols as usize {
            let target =
                &mut materials[chunk.core.y as usize + local_y][chunk.core.x as usize + local_x];
            if target.replace(source[offset_x + local_x]).is_some() {
                return Err(anyhow!("terrain chunk cores overlap material authority"));
            }
        }
    }
    for local_y in 0..=chunk.core.rows as usize {
        for local_x in 0..=chunk.core.cols as usize {
            let value = chunk.vertex_heights[offset_y + local_y][offset_x + local_x];
            let target =
                &mut vertices[chunk.core.y as usize + local_y][chunk.core.x as usize + local_x];
            if let Some(existing) = target {
                if *existing != value {
                    return Err(anyhow!("terrain chunk shared vertex authority drifts"));
                }
            } else {
                *target = Some(value);
            }
        }
    }
    if let Some(water_depths) = water_depths {
        let water = chunk
            .water_authority
            .as_ref()
            .ok_or_else(|| anyhow!("terrain chunk is missing indexed water authority"))?;
        let samples = water.samples_per_tile as usize;
        for local_y in 0..chunk.core.rows as usize {
            for local_x in 0..chunk.core.cols as usize {
                let source_x = (offset_x + local_x) * samples;
                let source_y = (offset_y + local_y) * samples;
                let mut maximum_depth = 0.0_f32;
                for sample_y in 0..samples {
                    for sample_x in 0..samples {
                        maximum_depth = maximum_depth
                            .max(water.depth[source_y + sample_y][source_x + sample_x]);
                    }
                }
                let target = &mut water_depths[chunk.core.y as usize + local_y]
                    [chunk.core.x as usize + local_x];
                if target.replace(maximum_depth).is_some() {
                    return Err(anyhow!("terrain chunk cores overlap water authority"));
                }
            }
        }
    }
    Ok(())
}

fn read_bounded(path: &Path, max_bytes: u64, label: &str) -> anyhow::Result<Vec<u8>> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("failed to inspect {label} {}", path.display()))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > max_bytes {
        return Err(anyhow!("{label} {} exceeds its byte bound", path.display()));
    }
    fs::read(path).with_context(|| format!("failed to read {label} {}", path.display()))
}

fn verify_sha256(bytes: &[u8], expected: &str, label: &str) -> anyhow::Result<()> {
    if !valid_sha256(expected) || sha256_hex(bytes) != expected {
        return Err(anyhow!(
            "{label} SHA-256 does not match its pinned authority"
        ));
    }
    Ok(())
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase())
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::{json, Value};

    use super::*;
    use crate::protocol::TerrainSnapshot;
    use crate::terrain::{TerrainAuthority, TerrainMaterial};

    #[test]
    fn reconstructs_verified_chunk_authority_and_rejects_rehashed_seam_drift() {
        let root = fixture_root();
        fs::create_dir_all(root.join("chunks")).expect("fixture directory is writable");
        let (mut index, mut authority) = write_fixture(&root);
        let materials = vec!["grass".to_string(), "field".to_string()];
        let index_path = root.join("chunks/index.json");
        let baked = load_chunked_terrain_grid(&index_path, &authority, &materials, 4, 2, 64, 0, 1)
            .expect("valid chunks reconstruct server authority");
        let terrain = TerrainAuthority::with_baked_grid(
            TerrainSnapshot {
                profile: "duskfell-terrain-v1".to_string(),
                seed: 1,
                detail_authority_enabled: false,
                visual_detail_enabled: true,
                units_per_tile: 64,
                tile_width: 64,
                tile_height: 64,
                height_scale: 20.0,
                min_elevation: 0,
                max_elevation: 1,
                water_level: 0,
                max_walkable_step: 1,
                vertex_height_precision: 1000,
                materials: materials.clone(),
                trails: Vec::new(),
            },
            256.0,
            128.0,
            0.0,
            Some(baked),
        );
        assert_eq!(
            terrain.material_at_world(32.0, 32.0),
            TerrainMaterial::Grass
        );
        assert_eq!(
            terrain.material_at_world(224.0, 32.0),
            TerrainMaterial::Field
        );
        assert!((terrain.height_at_world(32.0, 32.0) - 0.0055).abs() < 0.000_001);
        assert!((terrain.water_depth_at_world(32.0, 32.0) - 0.08).abs() < f32::EPSILON);
        assert!(!terrain.is_walkable_at_world(32.0, 32.0));

        let east_path = root.join("chunks/chunk-1-0.json");
        let mut east: Value = serde_json::from_slice(&fs::read(&east_path).unwrap()).unwrap();
        east["vertexHeights"][0][1] = json!(3);
        let east_bytes = serde_json::to_vec(&east).unwrap();
        fs::write(&east_path, &east_bytes).unwrap();
        index["chunks"][1]["bytes"] = json!(east_bytes.len());
        index["chunks"][1]["sha256"] = json!(sha256_hex(&east_bytes));
        let total = index["chunks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["bytes"].as_u64().unwrap())
            .sum::<u64>();
        authority.total_bytes = total;
        let index_bytes = serde_json::to_vec(&index).unwrap();
        fs::write(&index_path, &index_bytes).unwrap();
        authority.index_sha256 = sha256_hex(&index_bytes);
        let error = load_chunked_terrain_grid(&index_path, &authority, &materials, 4, 2, 64, 0, 1)
            .expect_err("rehashed shared-vertex drift must fail closed");
        assert!(error.to_string().contains("shared vertex authority drifts"));
        fs::remove_dir_all(root).unwrap();
    }

    fn write_fixture(root: &Path) -> (Value, ChunkAuthorityContent) {
        let west = chunk_fixture(0, 0, 2, 0, 3, &["000", "000"]);
        let east = chunk_fixture(1, 2, 2, 1, 3, &["011", "011"]);
        let mut entries = Vec::new();
        for (id, chunk) in [("0-0", west), ("1-0", east)] {
            let bytes = serde_json::to_vec(&chunk).unwrap();
            let filename = format!("chunks/chunk-{id}.json");
            fs::write(root.join(&filename), &bytes).unwrap();
            let x = if id == "0-0" { 0 } else { 1 };
            entries.push(json!({
                "id": id,
                "coord": { "x": x, "y": 0 },
                "core": { "x": x * 2, "y": 0, "cols": 2, "rows": 2 },
                "sample": { "x": if x == 0 { 0 } else { 1 }, "y": 0, "cols": 3, "rows": 2 },
                "path": filename,
                "sha256": sha256_hex(&bytes),
                "bytes": bytes.len(),
            }));
        }
        let total_bytes = entries
            .iter()
            .map(|entry| entry["bytes"].as_u64().unwrap())
            .sum();
        let index = json!({
            "schema": "duskfell-world-chunk-index-v1",
            "world": "chunk-proof",
            "dimensions": { "cols": 4, "rows": 2, "unitsPerTile": 64 },
            "chunkTiles": 2,
            "apronTiles": 1,
            "vertexHeightPrecision": 1000,
            "grid": { "cols": 2, "rows": 1 },
            "waterAuthority": { "schema": "duskfell-water-authority-v1", "samplesPerTile": 1 },
            "chunks": entries,
        });
        let index_bytes = serde_json::to_vec(&index).unwrap();
        fs::write(root.join("chunks/index.json"), &index_bytes).unwrap();
        let authority = ChunkAuthorityContent {
            schema_version: "duskfell-world-chunk-index-v1".to_string(),
            index_sha256: sha256_hex(&index_bytes),
            chunk_count: 2,
            chunk_tiles: 2,
            apron_tiles: 1,
            vertex_height_precision: 1000,
            total_bytes,
        };
        (index, authority)
    }

    fn chunk_fixture(
        coord_x: u32,
        core_x: u32,
        core_cols: u32,
        sample_x: u32,
        sample_cols: u32,
        materials: &[&str],
    ) -> Value {
        let heights = (0..=2)
            .map(|y| {
                (sample_x..=sample_x + sample_cols)
                    .map(|x| y * 10 + x)
                    .collect::<Vec<u32>>()
            })
            .collect::<Vec<Vec<u32>>>();
        let water_grid = |wet: f32, dry: f32| {
            (0..2)
                .map(|_| {
                    (sample_x..sample_x + sample_cols)
                        .map(|x| if x == 0 { wet } else { dry })
                        .collect::<Vec<f32>>()
                })
                .collect::<Vec<Vec<f32>>>()
        };
        let water_direction = (0..2)
            .map(|_| {
                (sample_x..sample_x + sample_cols)
                    .map(|x| if x == 0 { 0_i8 } else { -1_i8 })
                    .collect::<Vec<i8>>()
            })
            .collect::<Vec<Vec<i8>>>();
        json!({
            "schema": "duskfell-world-chunk-v1",
            "world": "chunk-proof",
            "id": format!("{coord_x}-0"),
            "coord": { "x": coord_x, "y": 0 },
            "core": { "x": core_x, "y": 0, "cols": core_cols, "rows": 2 },
            "sample": { "x": sample_x, "y": 0, "cols": sample_cols, "rows": 2 },
            "unitsPerTile": 64,
            "vertexHeightPrecision": 1000,
            "vertexHeights": heights,
            "waterAuthority": {
                "schema": "duskfell-water-authority-v1",
                "algorithm": "priority-flood-surface-depth-flow-v1",
                "samplesPerTile": 1,
                "unitsPerTile": 64,
                "heightEncoding": "world-elevation-levels-v1",
                "heightScale": 2,
                "sample": { "x": sample_x, "y": 0, "cols": sample_cols, "rows": 2 },
                "wetMask": water_grid(1.0, 0.0),
                "surfaceHeight": water_grid(0.08, 0.0),
                "depth": water_grid(0.08, 0.0),
                "flowDirectionD8": water_direction,
                "flowStrength": water_grid(0.5, 0.0)
            },
            "materialGrid": materials,
        })
    }

    fn fixture_root() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "duskfell-terrain-chunks-{}-{nonce}",
            std::process::id()
        ))
    }
}
