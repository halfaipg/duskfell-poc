use std::fs;
use std::path::Path;

use anyhow::{anyhow, Context};

use crate::persistence::ensure_file_within_size;
use crate::sim::TerrainDetailAuthority;

use super::model::RuntimeTerrainAuthorityManifest;
use super::validation::{
    required_array_len, required_string, required_u64, stable_runtime_fingerprint,
};

pub(super) fn load_terrain_authority_runtime_manifest(
    assets_dir: &Path,
    max_runtime_manifest_bytes: u64,
) -> anyhow::Result<RuntimeTerrainAuthorityManifest> {
    let manifest_path = assets_dir.join("terrain").join("detail-authority.json");
    ensure_file_within_size(
        &manifest_path,
        max_runtime_manifest_bytes,
        "MAX_RUNTIME_MANIFEST_BYTES",
        "terrain detail authority manifest",
    )?;
    let raw = fs::read_to_string(&manifest_path)
        .with_context(|| format!("failed to read {}", manifest_path.display()))?;
    let json: serde_json::Value = serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse {}", manifest_path.display()))?;
    let schema_version = required_string(&json, "schemaVersion")?;
    if schema_version != "duskfell-terrain-detail-authority-v1" {
        return Err(anyhow!(
            "{} schemaVersion must be duskfell-terrain-detail-authority-v1",
            manifest_path.display()
        ));
    }
    let projection = required_string(&json, "projection").context("terrainAuthority.projection")?;
    if projection != "military-plan-oblique" {
        return Err(anyhow!(
            "{} projection must be military-plan-oblique",
            manifest_path.display()
        ));
    }
    let profile = required_string(&json, "profile").context("terrainAuthority.profile")?;
    let seed = required_u64(&json, "seed").context("terrainAuthority.seed")?;
    let units_per_tile =
        required_u64(&json, "unitsPerTile").context("terrainAuthority.unitsPerTile")?;
    let blocker_count = required_array_len(&json, "blockers")?;
    let resource_node_count = required_array_len(&json, "resourceNodes")?;
    let decay_consumer_count = required_array_len(&json, "decayConsumers")?;
    if blocker_count == 0 || resource_node_count == 0 || decay_consumer_count == 0 {
        return Err(anyhow!(
            "{} terrain detail authority manifest must include blockers, resourceNodes, and decayConsumers",
            manifest_path.display()
        ));
    }

    Ok(RuntimeTerrainAuthorityManifest {
        kind: "terrain-authority",
        schema_version,
        path: manifest_path.display().to_string(),
        manifest_fingerprint: stable_runtime_fingerprint(raw.as_bytes()),
        manifest_bytes: raw.len() as u64,
        max_manifest_bytes: max_runtime_manifest_bytes,
        projection,
        profile,
        seed,
        units_per_tile,
        blocker_count,
        resource_node_count,
        decay_consumer_count,
    })
}

pub(crate) fn load_terrain_detail_authority_for_sim(
    assets_dir: &Path,
    max_runtime_manifest_bytes: u64,
) -> anyhow::Result<TerrainDetailAuthority> {
    let manifest_path = assets_dir.join("terrain").join("detail-authority.json");
    ensure_file_within_size(
        &manifest_path,
        max_runtime_manifest_bytes,
        "MAX_RUNTIME_MANIFEST_BYTES",
        "terrain detail authority manifest",
    )?;
    let raw = fs::read_to_string(&manifest_path)
        .with_context(|| format!("failed to read {}", manifest_path.display()))?;
    serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse {}", manifest_path.display()))
}
