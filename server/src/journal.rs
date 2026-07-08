use std::collections::VecDeque;

mod model;

pub use model::{JournalEvent, JournalEventKind};

pub const DEFAULT_RETAINED_EVENTS: usize = 10_000;

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
mod tests;
