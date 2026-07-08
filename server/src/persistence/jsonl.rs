use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use anyhow::Context;

use crate::journal::JournalEvent;

#[derive(Debug)]
pub struct JsonlEventWriter {
    path: PathBuf,
    file: File,
    sync_writes: bool,
}

impl JsonlEventWriter {
    #[cfg(test)]
    pub fn open(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        Self::open_with_sync(path, false)
    }

    pub fn open_with_sync(path: impl AsRef<Path>, sync_writes: bool) -> anyhow::Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create journal dir {}", parent.display()))?;
        }
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .with_context(|| format!("failed to open journal {}", path.display()))?;

        Ok(Self {
            path,
            file,
            sync_writes,
        })
    }

    pub fn append(&mut self, event: &JournalEvent) -> anyhow::Result<()> {
        serde_json::to_writer(&mut self.file, event).with_context(|| {
            format!(
                "failed to serialize journal event to {}",
                self.path.display()
            )
        })?;
        self.file.write_all(b"\n").with_context(|| {
            format!("failed to write journal newline to {}", self.path.display())
        })?;
        self.file
            .flush()
            .with_context(|| format!("failed to flush journal {}", self.path.display()))?;
        if self.sync_writes {
            self.file
                .sync_data()
                .with_context(|| format!("failed to sync journal {}", self.path.display()))?;
        }
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    #[cfg(test)]
    pub fn sync_writes(&self) -> bool {
        self.sync_writes
    }
}

pub fn for_each_jsonl_line(
    path: impl AsRef<Path>,
    max_line_bytes: usize,
    label: &str,
    mut on_line: impl FnMut(usize, &str) -> anyhow::Result<()>,
) -> anyhow::Result<()> {
    let path = path.as_ref();
    if !path.exists() {
        return Ok(());
    }

    let file =
        File::open(path).with_context(|| format!("failed to read {label} {}", path.display()))?;
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    let mut line_number = 0;

    loop {
        line.clear();
        let bytes = reader.read_until(b'\n', &mut line).with_context(|| {
            format!(
                "failed to read {label} line {} from {}",
                line_number + 1,
                path.display()
            )
        })?;
        if bytes == 0 {
            break;
        }
        line_number += 1;
        if line.len() > max_line_bytes {
            anyhow::bail!(
                "{label} line {} from {} is {} bytes, exceeding MAX_DURABLE_LINE_BYTES {}",
                line_number,
                path.display(),
                line.len(),
                max_line_bytes
            );
        }
        let text = std::str::from_utf8(&line).with_context(|| {
            format!(
                "failed to decode {label} line {} from {} as UTF-8",
                line_number,
                path.display()
            )
        })?;
        on_line(line_number, text)?;
    }

    Ok(())
}
