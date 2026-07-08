use uuid::Uuid;

use super::*;

#[test]
fn recent_events_are_bounded_and_ordered() {
    let mut journal = EventJournal::default();
    let player_id = Uuid::new_v4();
    for tick in 0..5 {
        journal.record(
            tick,
            JournalEventKind::PlayerJoined {
                player_id,
                account_subject: None,
            },
        );
    }

    let events = journal.recent(3);
    assert_eq!(events.len(), 3);
    assert_eq!(events[0].sequence, 3);
    assert_eq!(events[2].sequence, 5);
}

#[test]
fn recent_uses_requested_limit_without_endpoint_cap() {
    let mut journal = EventJournal::default();
    let player_id = Uuid::new_v4();
    for tick in 0..205 {
        journal.record(
            tick,
            JournalEventKind::PlayerJoined {
                player_id,
                account_subject: None,
            },
        );
    }

    assert_eq!(journal.recent(0).len(), 0);
    assert_eq!(journal.recent(205).len(), 205);
}

#[test]
fn after_returns_retained_events_newer_than_sequence() {
    let mut journal = EventJournal::default();
    let player_id = Uuid::new_v4();
    for tick in 0..5 {
        journal.record(
            tick,
            JournalEventKind::PlayerJoined {
                player_id,
                account_subject: None,
            },
        );
    }

    let events = journal.after(2, 2);
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].sequence, 3);
    assert_eq!(events[1].sequence, 4);
    assert!(journal.after(5, 10).is_empty());
    assert!(journal.after(0, 0).is_empty());
}

#[test]
fn replayed_events_continue_sequence_numbers() {
    let player_id = Uuid::new_v4();
    let mut journal = EventJournal::from_replayed(
        vec![
            JournalEvent {
                sequence: 2,
                tick: 7,
                kind: JournalEventKind::PlayerJoined {
                    player_id,
                    account_subject: None,
                },
            },
            JournalEvent {
                sequence: 9,
                tick: 8,
                kind: JournalEventKind::PlayerLeft { player_id },
            },
        ],
        9,
        DEFAULT_RETAINED_EVENTS,
    );

    let event = journal.record(
        10,
        JournalEventKind::PlayerJoined {
            player_id,
            account_subject: None,
        },
    );

    assert_eq!(journal.len(), 3);
    assert_eq!(event.sequence, 10);
}

#[test]
fn retention_limits_in_memory_events_but_not_sequence() {
    let player_id = Uuid::new_v4();
    let mut journal = EventJournal::new(2);

    for tick in 0..5 {
        journal.record(
            tick,
            JournalEventKind::PlayerJoined {
                player_id,
                account_subject: None,
            },
        );
    }

    let events = journal.recent(10);
    assert_eq!(journal.len(), 2);
    assert_eq!(journal.last_sequence(), 5);
    assert_eq!(events[0].sequence, 4);
    assert_eq!(events[1].sequence, 5);
    assert_eq!(journal.after(2, 10)[0].sequence, 4);
}
