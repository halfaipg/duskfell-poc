use std::fs;
use std::path::{Component, Path};

use anyhow::{anyhow, Context};
use sha2::{Digest, Sha256};

use super::model::RuntimeProjection;

pub(super) fn runtime_projection(json: &serde_json::Value) -> anyhow::Result<RuntimeProjection> {
    let projection = json
        .get("projection")
        .ok_or_else(|| anyhow!("projection must be present"))?;
    Ok(RuntimeProjection {
        kind: required_string(projection, "kind").context("projection.kind")?,
        tile_width: required_u64(projection, "tileWidth").context("projection.tileWidth")?,
        tile_height: required_u64(projection, "tileHeight").context("projection.tileHeight")?,
        tile_aspect_ratio: required_f64(projection, "tileAspectRatio")
            .context("projection.tileAspectRatio")?,
        axis_angle_degrees: required_u64(projection, "axisAngleDegrees")
            .context("projection.axisAngleDegrees")?,
        height_axis: required_string(projection, "heightAxis").context("projection.heightAxis")?,
        units_per_tile: required_u64(projection, "unitsPerTile")
            .context("projection.unitsPerTile")?,
    })
}

pub(super) fn verified_runtime_image_bytes(
    root: &Path,
    image: &str,
    expected_sha256: &str,
    max_runtime_asset_bytes: usize,
) -> anyhow::Result<u64> {
    if !is_safe_relative_asset_path(image) {
        return Err(anyhow!(
            "asset image path is not a safe relative path: {image}"
        ));
    }
    let image_path = root.join(image);
    let metadata = image_path
        .metadata()
        .with_context(|| format!("failed to stat asset image {}", image_path.display()))?;
    if !metadata.is_file() {
        return Err(anyhow!(
            "asset image is not a file: {}",
            image_path.display()
        ));
    }
    let image_bytes = metadata.len();
    if image_bytes > max_runtime_asset_bytes as u64 {
        return Err(anyhow!(
            "asset image exceeded MAX_RUNTIME_ASSET_BYTES for {}: bytes={} max={}",
            image_path.display(),
            image_bytes,
            max_runtime_asset_bytes
        ));
    }
    let bytes = fs::read(&image_path)
        .with_context(|| format!("failed to read asset image {}", image_path.display()))?;
    let actual_sha256 = sha256_hex(&bytes);
    if actual_sha256 != expected_sha256 {
        return Err(anyhow!(
            "asset image SHA-256 mismatch for {}: manifest={} actual={}",
            image_path.display(),
            expected_sha256,
            actual_sha256
        ));
    }
    Ok(image_bytes)
}

pub(super) fn required_string(json: &serde_json::Value, field: &str) -> anyhow::Result<String> {
    json.get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| anyhow!("{field} must be a string"))
}

pub(super) fn required_object_string(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> anyhow::Result<String> {
    object
        .get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| anyhow!("{field} must be a string"))
}

pub(super) fn required_u64(json: &serde_json::Value, field: &str) -> anyhow::Result<u64> {
    json.get(field)
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| anyhow!("{field} must be an unsigned integer"))
}

pub(super) fn required_array_len(json: &serde_json::Value, field: &str) -> anyhow::Result<usize> {
    json.get(field)
        .and_then(serde_json::Value::as_array)
        .map(Vec::len)
        .ok_or_else(|| anyhow!("{field} must be an array"))
}

pub(super) fn validate_sha256_pin(value: &str) -> anyhow::Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(anyhow!("must be a lowercase SHA-256 hex digest"));
    }
    Ok(())
}

pub(super) fn stable_runtime_fingerprint(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64:{hash:016x}")
}

fn required_f64(json: &serde_json::Value, field: &str) -> anyhow::Result<f64> {
    let value = json
        .get(field)
        .and_then(serde_json::Value::as_f64)
        .ok_or_else(|| anyhow!("{field} must be a number"))?;
    if !value.is_finite() || value <= 0.0 {
        return Err(anyhow!("{field} must be a positive finite number"));
    }
    Ok(value)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn is_safe_relative_asset_path(value: &str) -> bool {
    let path = Path::new(value);
    !path.is_absolute()
        && !value.is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}
