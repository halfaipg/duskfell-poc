use std::collections::VecDeque;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::protocol::PlayerId;
use crate::protocol::ResourceKind;

pub const DEFAULT_RETAINED_EVENTS: usize = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEvent {
    pub sequence: u64,
    pub tick: u64,
    pub kind: JournalEventKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum JournalEventKind {
    PlayerJoined {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "accountSubject", skip_serializing_if = "Option::is_none")]
        account_subject: Option<String>,
    },
    PlayerLeft {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
    },
    PlayerRenamed {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        name: String,
    },
    OwnershipClaimed {
        #[serde(rename = "jobId")]
        job_id: Uuid,
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "accountSubject", skip_serializing_if = "Option::is_none")]
        account_subject: Option<String>,
        #[serde(rename = "assetId")]
        asset_id: String,
        reason: String,
    },
    ResourceGathered {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "objectId")]
        object_id: String,
        resource: ResourceKind,
        amount: u32,
        total: u32,
    },
    ResourceNodeChanged {
        #[serde(rename = "objectId")]
        object_id: String,
        resource: ResourceKind,
        amount: u32,
        #[serde(rename = "maxAmount")]
        max_amount: u32,
    },
    ResourceFed {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "objectId")]
        object_id: String,
        #[serde(rename = "inputResource")]
        input_resource: ResourceKind,
        #[serde(rename = "inputAmount")]
        input_amount: u32,
        #[serde(rename = "inputTotal")]
        input_total: u32,
        #[serde(rename = "outputResource")]
        output_resource: ResourceKind,
        #[serde(rename = "outputAmount")]
        output_amount: u32,
        #[serde(rename = "outputTotal")]
        output_total: u32,
    },
    ItemCrafted {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "objectId")]
        object_id: String,
        #[serde(rename = "itemId")]
        item_id: String,
        amount: u32,
        total: u32,
    },
    SettlementPersistenceFailed {
        #[serde(rename = "jobId")]
        job_id: Uuid,
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        #[serde(rename = "accountSubject", skip_serializing_if = "Option::is_none")]
        account_subject: Option<String>,
        #[serde(rename = "assetId")]
        asset_id: String,
        error: String,
    },
    BadClientMessage {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        error: String,
    },
    ClientMessageRejected {
        #[serde(rename = "playerId")]
        player_id: PlayerId,
        reason: String,
    },
}

#[derive(Debug)]
pub struct EventJournal {
    next_sequence: u64,
    retained_limit: usize,
    events: VecDeque<JournalEvent>,
}

impl EventJournal {
    #[cfg(test)]
    pub fn new(retained_limit: usize) -> Self {
        Self {
            next_sequence: 0,
            retained_limit,
            events: VecDeque::new(),
        }
    }

    pub fn from_replayed(
        events: Vec<JournalEvent>,
        next_sequence: u64,
        retained_limit: usize,
    ) -> Self {
        let mut journal = Self {
            next_sequence,
            retained_limit,
            events: events.into(),
        };
        journal.trim_retained();
        journal
    }

    pub fn retained_capacity(&self) -> usize {
        self.retained_limit
    }

    pub fn last_sequence(&self) -> u64 {
        self.next_sequence
    }

    pub fn retained_events(&self) -> usize {
        self.events.len()
    }

    pub fn record(&mut self, tick: u64, kind: JournalEventKind) -> JournalEvent {
        self.next_sequence += 1;
        let event = JournalEvent {
            sequence: self.next_sequence,
            tick,
            kind,
        };
        self.events.push_back(event.clone());
        self.trim_retained();
        event
    }

    pub fn recent(&self, limit: usize) -> Vec<JournalEvent> {
        self.events
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }

    pub fn after(&self, sequence: u64, limit: usize) -> Vec<JournalEvent> {
        self.events
            .iter()
            .filter(|event| event.sequence > sequence)
            .take(limit)
            .cloned()
            .collect()
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.events.len()
    }

    fn trim_retained(&mut self) {
        while self.events.len() > self.retained_limit {
            self.events.pop_front();
        }
    }
}

impl Default for EventJournal {
    fn default() -> Self {
        Self {
            next_sequence: 0,
            retained_limit: DEFAULT_RETAINED_EVENTS,
            events: VecDeque::new(),
        }
    }
}

#[cfg(test)]
mod tests {
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
}
