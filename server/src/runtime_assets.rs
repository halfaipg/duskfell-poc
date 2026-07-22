mod asset_manifests;
mod model;
mod terrain_authority;
mod validation;

use std::path::Path;

use crate::content::ContentManifest;

use self::asset_manifests::{load_sprite_runtime_manifest, load_terrain_runtime_manifest};
pub(crate) use self::model::RuntimeManifest;
use self::terrain_authority::load_terrain_authority_runtime_manifest;
pub(crate) use self::terrain_authority::load_terrain_detail_authority_for_sim;

impl RuntimeManifest {
    pub(crate) fn load(
        assets_dir: &Path,
        terrain_authority_path: &Path,
        content: ContentManifest,
        max_runtime_manifest_bytes: u64,
        max_runtime_asset_bytes: usize,
    ) -> anyhow::Result<Self> {
        Ok(Self {
            app: model::RuntimeAppManifest {
                game: "Duskfell",
                chain: "Base",
                ticker: "$DUSK",
                server_crate: env!("CARGO_PKG_NAME"),
                server_version: env!("CARGO_PKG_VERSION"),
                build_git_sha: option_env!("GIT_SHA"),
            },
            content,
            assets: model::RuntimeAssetManifests {
                sprites: load_sprite_runtime_manifest(
                    assets_dir,
                    max_runtime_manifest_bytes,
                    max_runtime_asset_bytes,
                )?,
                terrain: load_terrain_runtime_manifest(
                    assets_dir,
                    max_runtime_manifest_bytes,
                    max_runtime_asset_bytes,
                )?,
                terrain_authority: load_terrain_authority_runtime_manifest(
                    terrain_authority_path,
                    max_runtime_manifest_bytes,
                )?,
            },
        })
    }
}
