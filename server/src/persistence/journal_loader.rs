use std::path::Path;

use anyhow::Context;

use crate::journal::JournalEvent;

use super::for_each_jsonl_line;

#[derive(Debug)]
pub struct LoadedJournalEvents {
    pub events: Vec<JournalEvent>,
    pub total_events: usize,
    pub next_sequence: u64,
    pub sequence_anomalies: usize,
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
        let event = serde_json::from_str::<JournalEvent>(line).with_context(|| {
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
