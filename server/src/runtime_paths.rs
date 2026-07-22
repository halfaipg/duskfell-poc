use std::path::Path;
use std::path::PathBuf;

pub fn client_dir() -> PathBuf {
    std::env::var("CLIENT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| workspace_root().join("client"))
}

pub fn assets_dir() -> PathBuf {
    std::env::var("ASSETS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| workspace_root().join("assets"))
}

pub fn review_worlds_dir() -> PathBuf {
    std::env::var("REVIEW_WORLDS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| workspace_root().join("worlds").join("generated"))
}

pub fn terrain_detail_authority_path(assets_dir: &Path) -> PathBuf {
    std::env::var("TERRAIN_DETAIL_AUTHORITY_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| assets_dir.join("terrain").join("detail-authority.json"))
}

pub fn terrain_chunk_index_path() -> Option<PathBuf> {
    std::env::var_os("TERRAIN_CHUNK_INDEX_PATH").map(PathBuf::from)
}

pub fn content_path() -> PathBuf {
    std::env::var("CONTENT_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("data")
                .join("world.json")
        })
}

pub fn journal_path() -> PathBuf {
    std::env::var("JOURNAL_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| workspace_root().join("var").join("journal.jsonl"))
}

pub fn settlement_outbox_path() -> PathBuf {
    std::env::var("SETTLEMENT_OUTBOX_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| workspace_root().join("var").join("settlement-outbox.jsonl"))
}

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("server crate has workspace parent")
        .to_path_buf()
}
