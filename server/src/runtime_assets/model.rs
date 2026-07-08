use serde::Serialize;

use crate::content::ContentManifest;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeManifest {
    pub(super) app: RuntimeAppManifest,
    pub(super) content: ContentManifest,
    pub(super) assets: RuntimeAssetManifests,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeAppManifest {
    pub(super) game: &'static str,
    pub(super) chain: &'static str,
    pub(super) ticker: &'static str,
    pub(super) server_crate: &'static str,
    pub(super) server_version: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) build_git_sha: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeAssetManifests {
    pub(super) sprites: RuntimeAssetManifest,
    pub(super) terrain: RuntimeAssetManifest,
    pub(super) terrain_authority: RuntimeTerrainAuthorityManifest,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeAssetManifest {
    pub(super) kind: &'static str,
    pub(super) schema_version: String,
    pub(super) path: String,
    pub(super) manifest_fingerprint: String,
    pub(super) manifest_bytes: u64,
    pub(super) max_manifest_bytes: u64,
    pub(super) max_image_bytes: usize,
    pub(super) projection: RuntimeProjection,
    pub(super) entry_count: usize,
    pub(super) images: Vec<RuntimeAssetImage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeTerrainAuthorityManifest {
    pub(super) kind: &'static str,
    pub(super) schema_version: String,
    pub(super) path: String,
    pub(super) manifest_fingerprint: String,
    pub(super) manifest_bytes: u64,
    pub(super) max_manifest_bytes: u64,
    pub(super) projection: String,
    pub(super) profile: String,
    pub(super) seed: u64,
    pub(super) units_per_tile: u64,
    pub(super) blocker_count: usize,
    pub(super) resource_node_count: usize,
    pub(super) decay_consumer_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeProjection {
    pub(super) kind: String,
    pub(super) tile_width: u64,
    pub(super) tile_height: u64,
    pub(super) tile_aspect_ratio: f64,
    pub(super) axis_angle_degrees: u64,
    pub(super) height_axis: String,
    pub(super) units_per_tile: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeAssetImage {
    pub(super) id: String,
    pub(super) image: String,
    pub(super) sha256: String,
    pub(super) sha256_verified: bool,
    pub(super) bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) approval_state: Option<String>,
}
