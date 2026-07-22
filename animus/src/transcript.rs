use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

pub const MAX_TURNS: usize = 16;
pub const MAX_TRANSCRIPT_BYTES: usize = 4096;
pub const IDLE_EXPIRY: Duration = Duration::from_secs(300);

/// Milestone conversation memory: a bounded ring per host-defined conversation.
/// The full tiered memory system (SQLite archive, reflection) replaces the
/// persistence story later; this keeps multi-turn dialogue coherent now.
#[derive(Debug, Default)]
pub struct TranscriptStore {
    transcripts: HashMap<String, Transcript>,
}

#[derive(Debug)]
struct Transcript {
    turns: VecDeque<Turn>,
    bytes: usize,
    last_active: Instant,
}

#[derive(Debug, Clone)]
pub struct Turn {
    pub speaker: String,
    pub text: String,
}

impl TranscriptStore {
    pub fn record(&mut self, conversation_id: &str, speaker: &str, text: &str) {
        self.record_at(conversation_id, speaker, text, Instant::now());
    }

    fn record_at(&mut self, conversation_id: &str, speaker: &str, text: &str, now: Instant) {
        let transcript = self
            .transcripts
            .entry(conversation_id.to_string())
            .or_insert_with(|| Transcript {
                turns: VecDeque::new(),
                bytes: 0,
                last_active: now,
            });
        if now.duration_since(transcript.last_active) > IDLE_EXPIRY {
            transcript.turns.clear();
            transcript.bytes = 0;
        }
        transcript.last_active = now;
        let turn = Turn {
            speaker: speaker.to_string(),
            text: text.to_string(),
        };
        transcript.bytes += turn.text.len() + turn.speaker.len();
        transcript.turns.push_back(turn);
        while transcript.turns.len() > MAX_TURNS || transcript.bytes > MAX_TRANSCRIPT_BYTES {
            if let Some(evicted) = transcript.turns.pop_front() {
                transcript.bytes -= evicted.text.len() + evicted.speaker.len();
            } else {
                break;
            }
        }
    }

    pub fn turns(&self, conversation_id: &str) -> Vec<Turn> {
        self.turns_at(conversation_id, Instant::now())
    }

    fn turns_at(&self, conversation_id: &str, now: Instant) -> Vec<Turn> {
        match self.transcripts.get(conversation_id) {
            Some(transcript) if now.duration_since(transcript.last_active) <= IDLE_EXPIRY => {
                transcript.turns.iter().cloned().collect()
            }
            _ => Vec::new(),
        }
    }

    pub fn turn_count(&self, conversation_id: &str) -> usize {
        self.turns(conversation_id).len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_and_returns_turns_in_order() {
        let mut store = TranscriptStore::default();
        store.record("maren", "Wayfarer", "hello");
        store.record("maren", "Maren", "Mm.");
        let turns = store.turns("maren");
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].speaker, "Wayfarer");
        assert_eq!(turns[1].text, "Mm.");
        assert!(store.turns("bram").is_empty());
    }

    #[test]
    fn bounds_turn_count() {
        let mut store = TranscriptStore::default();
        for index in 0..MAX_TURNS + 5 {
            store.record("maren", "Wayfarer", &format!("line {index}"));
        }
        let turns = store.turns("maren");
        assert_eq!(turns.len(), MAX_TURNS);
        assert_eq!(turns[0].text, "line 5");
    }

    #[test]
    fn bounds_total_bytes() {
        let mut store = TranscriptStore::default();
        let big = "x".repeat(1000);
        for _ in 0..10 {
            store.record("maren", "Wayfarer", &big);
        }
        let turns = store.turns("maren");
        assert!(turns.len() < 10);
        let bytes: usize = turns.iter().map(|turn| turn.text.len()).sum();
        assert!(bytes <= MAX_TRANSCRIPT_BYTES);
    }

    #[test]
    fn idle_transcripts_expire() {
        let mut store = TranscriptStore::default();
        let start = Instant::now();
        store.record_at("maren", "Wayfarer", "hello", start);
        let later = start + IDLE_EXPIRY + Duration::from_secs(1);
        assert!(store.turns_at("maren", later).is_empty());
        // A new turn after expiry starts a fresh conversation.
        store.record_at("maren", "Wayfarer", "back again", later);
        let turns = store.turns_at("maren", later);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].text, "back again");
    }
}
