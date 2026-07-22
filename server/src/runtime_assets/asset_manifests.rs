use std::fs;
use std::path::Path;

use anyhow::{anyhow, Context};

use crate::persistence::ensure_file_within_size;

use super::model::{RuntimeAssetImage, RuntimeAssetManifest};
use super::validation::{
    required_object_string, required_string, runtime_projection, stable_runtime_fingerprint,
    validate_sha256_pin, verified_runtime_image_bytes,
};

pub(super) fn load_sprite_runtime_manifest(
    assets_dir: &Path,
    max_runtime_manifest_bytes: u64,
    max_runtime_asset_bytes: usize,
) -> anyhow::Result<RuntimeAssetManifest> {
    let manifest_path = assets_dir.join("sprites").join("manifest.json");
    ensure_file_within_size(
        &manifest_path,
        max_runtime_manifest_bytes,
        "MAX_RUNTIME_MANIFEST_BYTES",
        "sprite manifest",
    )?;
    let raw = fs::read_to_string(&manifest_path)
        .with_context(|| format!("failed to read {}", manifest_path.display()))?;
    let json: serde_json::Value = serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse {}", manifest_path.display()))?;
    let schema_version = required_string(&json, "schemaVersion")?;
    let projection = runtime_projection(&json)?;
    let sheets = json
        .get("sheets")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| anyhow!("{} sheets must be an array", manifest_path.display()))?;
    let image_root = manifest_path
        .parent()
        .expect("sprite manifest has parent directory");
    let images = sheets
        .iter()
        .enumerate()
        .map(|(index, sheet)| {
            let id = required_string(sheet, "id")
                .with_context(|| format!("sprites.sheets[{index}].id"))?;
            let image = required_string(sheet, "image")
                .with_context(|| format!("sprites.sheets[{index}].image"))?;
            let sha256 = required_string(sheet, "imageSha256")
                .with_context(|| format!("sprites.sheets[{index}].imageSha256"))?;
            validate_sha256_pin(&sha256)
                .with_context(|| format!("sprites.sheets[{index}].imageSha256"))?;
            let bytes =
                verified_runtime_image_bytes(image_root, &image, &sha256, max_runtime_asset_bytes)?;
            let approval_state = sheet
                .pointer("/approval/state")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);
            Ok(RuntimeAssetImage {
                id,
                image,
                sha256,
                sha256_verified: true,
                bytes,
                approval_state,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;

    Ok(RuntimeAssetManifest {
        kind: "sprites",
        schema_version,
        path: manifest_path.display().to_string(),
        manifest_fingerprint: stable_runtime_fingerprint(raw.as_bytes()),
        manifest_bytes: raw.len() as u64,
        max_manifest_bytes: max_runtime_manifest_bytes,
        max_image_bytes: max_runtime_asset_bytes,
        projection,
        entry_count: sheets.len(),
        images,
    })
}

pub(super) fn load_terrain_runtime_manifest(
    assets_dir: &Path,
    max_runtime_manifest_bytes: u64,
    max_runtime_asset_bytes: usize,
) -> anyhow::Result<RuntimeAssetManifest> {
    let manifest_path = assets_dir.join("terrain").join("manifest.json");
    ensure_file_within_size(
        &manifest_path,
        max_runtime_manifest_bytes,
        "MAX_RUNTIME_MANIFEST_BYTES",
        "terrain manifest",
    )?;
    let raw = fs::read_to_string(&manifest_path)
        .with_context(|| format!("failed to read {}", manifest_path.display()))?;
    let json: serde_json::Value = serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse {}", manifest_path.display()))?;
    let schema_version = required_string(&json, "schemaVersion")?;
    let projection = runtime_projection(&json)?;
    let tiles = json
        .get("tiles")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| anyhow!("{} tiles must be an array", manifest_path.display()))?;
    let tile_sheet = json
        .get("tileSheet")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| anyhow!("{} tileSheet must be an object", manifest_path.display()))?;
    let image_root = manifest_path
        .parent()
        .expect("terrain manifest has parent directory");
    let id = required_object_string(tile_sheet, "id").context("terrain.tileSheet.id")?;
    let image = required_object_string(tile_sheet, "image").context("terrain.tileSheet.image")?;
    let sha256 =
        required_object_string(tile_sheet, "sha256").context("terrain.tileSheet.sha256")?;
    validate_sha256_pin(&sha256).context("terrain.tileSheet.sha256")?;
    let bytes = verified_runtime_image_bytes(image_root, &image, &sha256, max_runtime_asset_bytes)?;
    let approval_state = json
        .pointer("/approval/state")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let mut images = vec![RuntimeAssetImage {
        id,
        image,
        sha256,
        sha256_verified: true,
        bytes,
        approval_state: approval_state.clone(),
    }];
    let ground_patches = json
        .get("groundPatches")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| anyhow!("{} groundPatches must be an array", manifest_path.display()))?;
    for (index, patch) in ground_patches.iter().enumerate() {
        let id = required_string(patch, "id")
            .with_context(|| format!("terrain.groundPatches[{index}].id"))?;
        let image = required_string(patch, "image")
            .with_context(|| format!("terrain.groundPatches[{index}].image"))?;
        let sha256 = required_string(patch, "sha256")
            .with_context(|| format!("terrain.groundPatches[{index}].sha256"))?;
        validate_sha256_pin(&sha256)
            .with_context(|| format!("terrain.groundPatches[{index}].sha256"))?;
        let bytes =
            verified_runtime_image_bytes(image_root, &image, &sha256, max_runtime_asset_bytes)?;
        images.push(RuntimeAssetImage {
            id,
            image,
            sha256,
            sha256_verified: true,
            bytes,
            approval_state: approval_state.clone(),
        });
    }
    let world_map_count = if let Some(world_map) = json.get("worldMap") {
        let id = required_string(world_map, "id").context("terrain.worldMap.id")?;
        let image = required_string(world_map, "image").context("terrain.worldMap.image")?;
        let sha256 = required_string(world_map, "sha256").context("terrain.worldMap.sha256")?;
        validate_sha256_pin(&sha256).context("terrain.worldMap.sha256")?;
        let bytes =
            verified_runtime_image_bytes(image_root, &image, &sha256, max_runtime_asset_bytes)?;
        images.push(RuntimeAssetImage {
            id,
            image,
            sha256,
            sha256_verified: true,
            bytes,
            approval_state: approval_state.clone(),
        });
        1
    } else {
        0
    };

    Ok(RuntimeAssetManifest {
        kind: "terrain",
        schema_version,
        path: manifest_path.display().to_string(),
        manifest_fingerprint: stable_runtime_fingerprint(raw.as_bytes()),
        manifest_bytes: raw.len() as u64,
        max_manifest_bytes: max_runtime_manifest_bytes,
        max_image_bytes: max_runtime_asset_bytes,
        projection,
        entry_count: tiles.len() + ground_patches.len() + world_map_count,
        images,
    })
}
