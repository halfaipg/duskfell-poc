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
    let path = std::env::temp_dir().join(format!("sundermere-distinct-{}.jsonl", Uuid::new_v4()));

    let err = validate_distinct_durable_paths(&path, &path)
        .expect_err("matching durable paths should fail");

    assert!(err
        .to_string()
        .contains("JOURNAL_PATH and SETTLEMENT_OUTBOX_PATH"));
}

#[test]
fn appends_jsonl_events() {
    let path = std::env::temp_dir().join(format!("sundermere-journal-{}.jsonl", Uuid::new_v4()));
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
    let path = std::env::temp_dir().join(format!("sundermere-journal-{}.jsonl", Uuid::new_v4()));
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
    let path = std::env::temp_dir().join(format!("sundermere-journal-{}.jsonl", Uuid::new_v4()));
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
    let path = std::env::temp_dir().join(format!("sundermere-journal-{}.jsonl", Uuid::new_v4()));
    fs::write(&path, b"{not-json}\n").expect("malformed journal writes");

    let err = load_journal_events(&path, 10, DEFAULT_MAX_DURABLE_LINE_BYTES)
        .expect_err("malformed journal should fail");

    assert!(err.to_string().contains("failed to parse journal line 1"));

    let _ = fs::remove_file(path);
}

#[test]
fn oversized_jsonl_line_fails_replay_before_parse() {
    let path = std::env::temp_dir().join(format!("sundermere-journal-{}.jsonl", Uuid::new_v4()));
    fs::write(&path, b"{\"tooLong\":true}\n").expect("oversized journal writes");

    let err = load_journal_events(&path, 10, 8).expect_err("oversized line should fail");

    assert!(err.to_string().contains("journal line 1"));
    assert!(err.to_string().contains("MAX_DURABLE_LINE_BYTES"));

    let _ = fs::remove_file(path);
}

#[test]
fn load_retains_recent_events_but_tracks_full_sequence() {
    let path = std::env::temp_dir().join(format!("sundermere-journal-{}.jsonl", Uuid::new_v4()));
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

    let loaded =
        load_journal_events(&path, 2, DEFAULT_MAX_DURABLE_LINE_BYTES).expect("journal events load");

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
    let path = std::env::temp_dir().join(format!("sundermere-journal-{}.jsonl", Uuid::new_v4()));
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
