use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::Context;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::persistence::for_each_jsonl_line;
#[cfg(test)]
use crate::persistence::DEFAULT_MAX_DURABLE_LINE_BYTES;
use crate::protocol::SettlementReceiptSnapshot;

use super::validation::{validate_job, validate_receipt};
use super::SettlementJob;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SettlementOutboxEvent {
    JobQueued { job: SettlementJob },
    JobConfirmed { receipt: SettlementReceiptSnapshot },
}

#[derive(Debug)]
pub struct SettlementOutbox {
    path: PathBuf,
    file: File,
    events_written: usize,
    sync_writes: bool,
}

impl SettlementOutbox {
    #[cfg(test)]
    pub fn open(
        path: impl AsRef<Path>,
    ) -> anyhow::Result<(Self, Vec<SettlementJob>, Vec<SettlementReceiptSnapshot>)> {
        Self::open_with_options(path, false, DEFAULT_MAX_DURABLE_LINE_BYTES)
    }

    #[cfg(test)]
    pub fn open_with_sync(
        path: impl AsRef<Path>,
        sync_writes: bool,
    ) -> anyhow::Result<(Self, Vec<SettlementJob>, Vec<SettlementReceiptSnapshot>)> {
        Self::open_with_options(path, sync_writes, DEFAULT_MAX_DURABLE_LINE_BYTES)
    }

    pub fn open_with_options(
        path: impl AsRef<Path>,
        sync_writes: bool,
        max_line_bytes: usize,
    ) -> anyhow::Result<(Self, Vec<SettlementJob>, Vec<SettlementReceiptSnapshot>)> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).with_context(|| {
                format!(
                    "failed to create settlement outbox dir {}",
                    parent.display()
                )
            })?;
        }

        let (pending, receipts, events_written) = Self::load_state(&path, max_line_bytes)?;
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .with_context(|| format!("failed to open settlement outbox {}", path.display()))?;

        Ok((
            Self {
                path,
                file,
                events_written,
                sync_writes,
            },
            pending,
            receipts,
        ))
    }

    pub fn append_job(&mut self, job: &SettlementJob) -> anyhow::Result<()> {
        validate_job(job)?;
        self.append(&SettlementOutboxEvent::JobQueued { job: job.clone() })
    }

    pub fn append_receipt(&mut self, receipt: &SettlementReceiptSnapshot) -> anyhow::Result<()> {
        validate_receipt(receipt)?;
        self.append(&SettlementOutboxEvent::JobConfirmed {
            receipt: receipt.clone(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn events_written(&self) -> usize {
        self.events_written
    }

    #[cfg(test)]
    pub fn sync_writes(&self) -> bool {
        self.sync_writes
    }

    fn append(&mut self, event: &SettlementOutboxEvent) -> anyhow::Result<()> {
        serde_json::to_writer(&mut self.file, event).with_context(|| {
            format!(
                "failed to serialize settlement outbox {}",
                self.path.display()
            )
        })?;
        self.file.write_all(b"\n").with_context(|| {
            format!(
                "failed to write settlement outbox newline {}",
                self.path.display()
            )
        })?;
        self.file.flush().with_context(|| {
            format!("failed to flush settlement outbox {}", self.path.display())
        })?;
        if self.sync_writes {
            self.file.sync_data().with_context(|| {
                format!("failed to sync settlement outbox {}", self.path.display())
            })?;
        }
        self.events_written += 1;
        Ok(())
    }

    fn load_state(
        path: &Path,
        max_line_bytes: usize,
    ) -> anyhow::Result<(Vec<SettlementJob>, Vec<SettlementReceiptSnapshot>, usize)> {
        if !path.exists() {
            return Ok((Vec::new(), Vec::new(), 0));
        }

        let mut queued = HashMap::<Uuid, SettlementJob>::new();
        let mut confirmed_job_ids = HashSet::<Uuid>::new();
        let mut receipts = Vec::new();
        let mut events_written = 0;

        for_each_jsonl_line(
            path,
            max_line_bytes,
            "settlement outbox",
            |line_number, line| {
                if line.trim().is_empty() {
                    return Ok(());
                }
                events_written += 1;
                let event: SettlementOutboxEvent =
                    serde_json::from_str(&line).with_context(|| {
                        format!(
                            "failed to parse settlement outbox line {} from {}",
                            line_number,
                            path.display()
                        )
                    })?;
                match event {
                    SettlementOutboxEvent::JobQueued { job } => {
                        validate_job(&job).with_context(|| {
                            format!(
                                "invalid settlement job in outbox line {} from {}",
                                line_number,
                                path.display()
                            )
                        })?;
                        if !confirmed_job_ids.contains(&job.job_id) {
                            queued.entry(job.job_id).or_insert(job);
                        }
                    }
                    SettlementOutboxEvent::JobConfirmed { receipt } => {
                        validate_receipt(&receipt).with_context(|| {
                            format!(
                                "invalid settlement receipt in outbox line {} from {}",
                                line_number,
                                path.display()
                            )
                        })?;
                        if confirmed_job_ids.insert(receipt.job_id) {
                            queued.remove(&receipt.job_id);
                            receipts.push(receipt);
                        }
                    }
                }
                Ok(())
            },
        )?;

        Ok((queued.into_values().collect(), receipts, events_written))
    }
}
