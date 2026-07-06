use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context};

use crate::journal::JournalEvent;

pub const DEFAULT_MAX_DURABLE_LINE_BYTES: usize = 256 * 1024;

#[derive(Debug)]
pub struct LoadedJournalEvents {
    pub events: Vec<JournalEvent>,
    pub total_events: usize,
    pub next_sequence: u64,
    pub sequence_anomalies: usize,
}

#[derive(Debug)]
pub struct JsonlEventWriter {
    path: PathBuf,
    file: File,
    sync_writes: bool,
}

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

fn lock_path_for(path: &Path) -> PathBuf {
    let mut lock_path = path.as_os_str().to_os_string();
    lock_path.push(".lock");
    PathBuf::from(lock_path)
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

pub fn load_journal_events(
    path: impl AsRef<Path>,
    retained_limit: usize,
    max_line_bytes: usize,
) -> anyhow::Result<LoadedJournalEvents> {
    let path = path.as_ref();
    if !path.exists() {
        return Ok(LoadedJournalEvents {
            events: Vec::new(),
            total_events: 0,
            next_sequence: 0,
            sequence_anomalies: 0,
        });
    }

    let mut events = Vec::new();
    let mut total_events = 0;
    let mut next_sequence = 0;
    let mut sequence_anomalies = 0;
    for_each_jsonl_line(path, max_line_bytes, "journal", |line_number, line| {
        if line.trim().is_empty() {
            return Ok(());
        }
        let event = serde_json::from_str::<JournalEvent>(&line).with_context(|| {
            format!(
                "failed to parse journal line {} from {}",
                line_number,
                path.display()
            )
        })?;
        if event.sequence <= next_sequence {
            sequence_anomalies += 1;
        }
        next_sequence = next_sequence.max(event.sequence);
        total_events += 1;
        events.push(event);
        if events.len() > retained_limit {
            events.remove(0);
        }
        Ok(())
    })?;
    Ok(LoadedJournalEvents {
        events,
        total_events,
        next_sequence,
        sequence_anomalies,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use uuid::Uuid;

    use super::*;
    use crate::journal::{JournalEvent, JournalEventKind};

    #[test]
    fn rejects_file_over_size_limit() {
        let path = std::env::temp_dir().join(format!("sundermere-size-{}.jsonl", Uuid::new_v4()));
        fs::write(&path, b"0123456789").expect("test file writes");

        let err = ensure_file_within_size(&path, 4, "MAX_TEST_BYTES", "test file")
            .expect_err("file size cap rejects");

        assert!(err.to_string().contains("MAX_TEST_BYTES"));
        assert!(err.to_string().contains("exceeding"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn durable_file_lock_rejects_second_holder_and_cleans_up_on_drop() {
        let path = std::env::temp_dir().join(format!("sundermere-lock-{}.jsonl", Uuid::new_v4()));
        let lock = DurableFileLock::acquire_for_path(&path, "journal").expect("first lock opens");

        assert!(lock.path().exists());
        let err = DurableFileLock::acquire_for_path(&path, "journal")
            .expect_err("second lock holder should fail");
        assert!(err.to_string().contains("durable lock"));
        assert!(err.to_string().contains("already exists"));

        let lock_path = lock.path().to_path_buf();
        drop(lock);
        assert!(!lock_path.exists());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn durable_paths_must_be_distinct() {
        let path =
            std::env::temp_dir().join(format!("sundermere-distinct-{}.jsonl", Uuid::new_v4()));

        let err = validate_distinct_durable_paths(&path, &path)
            .expect_err("matching durable paths should fail");

        assert!(err
            .to_string()
            .contains("JOURNAL_PATH and SETTLEMENT_OUTBOX_PATH"));
    }

    #[test]
    fn appends_jsonl_events() {
        let path =
            std::env::temp_dir().join(format!("sundermere-journal-{}.jsonl", Uuid::new_v4()));
        let mut writer = JsonlEventWriter::open(&path).expect("writer opens");
        let player_id = Uuid::new_v4();
        let event = JournalEvent {
            sequence: 1,
            tick: 2,
            kind: JournalEventKind::PlayerJoined {
                player_id,
                account_subject: None,
            },
        };

        writer.append(&event).expect("event appends");
        let raw = fs::read_to_string(&path).expect("journal readable");
        assert!(raw.contains("\"sequence\":1"));
        assert!(raw.contains("\"playerJoined\""));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn appends_jsonl_events_with_sync_enabled() {
        let path =
            std::env::temp_dir().join(format!("sundermere-journal-{}.jsonl", Uuid::new_v4()));
        let mut writer = JsonlEventWriter::open_with_sync(&path, true).expect("writer opens");
        let player_id = Uuid::new_v4();

        writer
            .append(&JournalEvent {
                sequence: 1,
                tick: 2,
                kind: JournalEventKind::PlayerJoined {
                    player_id,
                    account_subject: None,
                },
            })
            .expect("event appends");
        let loaded = load_journal_events(&path, 10, DEFAULT_MAX_DURABLE_LINE_BYTES)
            .expect("synced journal event loads");

        assert!(writer.sync_writes());
        assert_eq!(loaded.total_events, 1);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn loads_existing_jsonl_events() {
        let path =
            std::env::temp_dir().join(format!("sundermere-journal-{}.jsonl", Uuid::new_v4()));
        let mut writer = JsonlEventWriter::open(&path).expect("writer opens");
        let player_id = Uuid::new_v4();
        writer
            .append(&JournalEvent {
                sequence: 1,
                tick: 2,
                kind: JournalEventKind::PlayerJoined {
                    player_id,
                    account_subject: None,
                },
            })
            .expect("first event appends");
        writer
            .append(&JournalEvent {
                sequence: 2,
                tick: 3,
                kind: JournalEventKind::PlayerLeft { player_id },
            })
            .expect("second event appends");

        let loaded = load_journal_events(&path, 10, DEFAULT_MAX_DURABLE_LINE_BYTES)
            .expect("journal events load");

        assert_eq!(loaded.total_events, 2);
        assert_eq!(loaded.next_sequence, 2);
        assert_eq!(loaded.sequence_anomalies, 0);
        assert_eq!(loaded.events.len(), 2);
        assert_eq!(loaded.events[0].sequence, 1);
        assert_eq!(loaded.events[1].sequence, 2);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn malformed_jsonl_event_fails_replay() {
        let path =
            std::env::temp_dir().join(format!("sundermere-journal-{}.jsonl", Uuid::new_v4()));
        fs::write(&path, b"{not-json}\n").expect("malformed journal writes");

        let err = load_journal_events(&path, 10, DEFAULT_MAX_DURABLE_LINE_BYTES)
            .expect_err("malformed journal should fail");

        assert!(err.to_string().contains("failed to parse journal line 1"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn oversized_jsonl_line_fails_replay_before_parse() {
        let path =
            std::env::temp_dir().join(format!("sundermere-journal-{}.jsonl", Uuid::new_v4()));
        fs::write(&path, b"{\"tooLong\":true}\n").expect("oversized journal writes");

        let err = load_journal_events(&path, 10, 8).expect_err("oversized line should fail");

        assert!(err.to_string().contains("journal line 1"));
        assert!(err.to_string().contains("MAX_DURABLE_LINE_BYTES"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn load_retains_recent_events_but_tracks_full_sequence() {
        let path =
            std::env::temp_dir().join(format!("sundermere-journal-{}.jsonl", Uuid::new_v4()));
        let mut writer = JsonlEventWriter::open(&path).expect("writer opens");
        let player_id = Uuid::new_v4();
        for sequence in 1..=5 {
            writer
                .append(&JournalEvent {
                    sequence,
                    tick: sequence,
                    kind: JournalEventKind::PlayerJoined {
                        player_id,
                        account_subject: None,
                    },
                })
                .expect("event appends");
        }

        let loaded = load_journal_events(&path, 2, DEFAULT_MAX_DURABLE_LINE_BYTES)
            .expect("journal events load");

        assert_eq!(loaded.total_events, 5);
        assert_eq!(loaded.next_sequence, 5);
        assert_eq!(loaded.sequence_anomalies, 0);
        assert_eq!(loaded.events.len(), 2);
        assert_eq!(loaded.events[0].sequence, 4);
        assert_eq!(loaded.events[1].sequence, 5);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn load_counts_non_increasing_sequence_anomalies() {
        let path =
            std::env::temp_dir().join(format!("sundermere-journal-{}.jsonl", Uuid::new_v4()));
        let mut writer = JsonlEventWriter::open(&path).expect("writer opens");
        let player_id = Uuid::new_v4();
        for sequence in [1, 2, 2, 1, 3] {
            writer
                .append(&JournalEvent {
                    sequence,
                    tick: sequence,
                    kind: JournalEventKind::PlayerJoined {
                        player_id,
                        account_subject: None,
                    },
                })
                .expect("event appends");
        }

        let loaded = load_journal_events(&path, 10, DEFAULT_MAX_DURABLE_LINE_BYTES)
            .expect("journal events load");

        assert_eq!(loaded.total_events, 5);
        assert_eq!(loaded.next_sequence, 3);
        assert_eq!(loaded.sequence_anomalies, 2);

        let _ = fs::remove_file(path);
    }
}
