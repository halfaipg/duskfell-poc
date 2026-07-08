use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context};

#[derive(Debug)]
pub struct DurableFileLock {
    path: PathBuf,
}

impl DurableFileLock {
    pub fn acquire_for_path(path: impl AsRef<Path>, label: &str) -> anyhow::Result<Self> {
        let path = path.as_ref();
        let lock_path = lock_path_for(path);
        if let Some(parent) = lock_path.parent() {
            std::fs::create_dir_all(parent).with_context(|| {
                format!("failed to create {label} lock dir {}", parent.display())
            })?;
        }

        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
            .map_err(|err| {
                if err.kind() == std::io::ErrorKind::AlreadyExists {
                    anyhow!(
                        "{label} durable lock {} already exists for {}; another server may be using this durable path",
                        lock_path.display(),
                        path.display()
                    )
                } else {
                    anyhow!(err).context(format!(
                        "failed to create {label} durable lock {}",
                        lock_path.display()
                    ))
                }
            })?;
        writeln!(file, "pid={}", std::process::id()).with_context(|| {
            format!(
                "failed to write {label} durable lock {}",
                lock_path.display()
            )
        })?;
        file.sync_data().with_context(|| {
            format!(
                "failed to sync {label} durable lock {}",
                lock_path.display()
            )
        })?;

        Ok(Self { path: lock_path })
    }

    #[cfg(test)]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for DurableFileLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

pub fn validate_distinct_durable_paths(
    journal_path: impl AsRef<Path>,
    settlement_outbox_path: impl AsRef<Path>,
) -> anyhow::Result<()> {
    let journal_path = journal_path.as_ref();
    let settlement_outbox_path = settlement_outbox_path.as_ref();
    if journal_path == settlement_outbox_path {
        anyhow::bail!("JOURNAL_PATH and SETTLEMENT_OUTBOX_PATH must be distinct durable files");
    }
    Ok(())
}

pub fn ensure_file_within_size(
    path: impl AsRef<Path>,
    max_bytes: u64,
    env_name: &str,
    label: &str,
) -> anyhow::Result<()> {
    let path = path.as_ref();
    if !path.exists() {
        return Ok(());
    }

    let bytes = path
        .metadata()
        .with_context(|| format!("failed to stat {label} {}", path.display()))?
        .len();
    if bytes > max_bytes {
        anyhow::bail!(
            "{label} {} is {bytes} bytes, exceeding {env_name} {max_bytes}",
            path.display()
        );
    }
    Ok(())
}

fn lock_path_for(path: &Path) -> PathBuf {
    let mut lock_path = path.as_os_str().to_os_string();
    lock_path.push(".lock");
    PathBuf::from(lock_path)
}
