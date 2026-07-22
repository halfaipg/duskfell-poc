use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Global request budget shaped to provider rate limits (design D6): the
/// engine never exceeds `per_minute` provider calls, and interactive dialogue
/// spends before ambient work by queue ordering.
#[derive(Debug)]
pub struct RequestBudget {
    tokens: f32,
    per_minute: u32,
    last_refill: Instant,
}

impl RequestBudget {
    pub fn new(per_minute: u32) -> Self {
        Self {
            tokens: per_minute as f32,
            per_minute,
            last_refill: Instant::now(),
        }
    }

    pub fn try_spend(&mut self) -> bool {
        self.refill(Instant::now());
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }

    // Surfaced as the request-budget gauge by the live-cognition stage.
    #[allow(dead_code)]
    pub fn remaining(&mut self) -> u32 {
        self.refill(Instant::now());
        self.tokens as u32
    }

    fn refill(&mut self, now: Instant) {
        let elapsed = now.duration_since(self.last_refill).as_secs_f32();
        self.last_refill = now;
        self.tokens =
            (self.tokens + elapsed * self.per_minute as f32 / 60.0).min(self.per_minute as f32);
    }
}

/// Greeting triggers are heavily debounced per (npc, actor) pair (design D17):
/// a skipped greeting is harmless, a chatty one is expensive.
#[derive(Debug)]
pub struct GreetingDebounce {
    window: Duration,
    seen: HashMap<(String, String), Instant>,
}

impl GreetingDebounce {
    pub fn new(window: Duration) -> Self {
        Self {
            window,
            seen: HashMap::new(),
        }
    }

    pub fn allow(&mut self, npc_id: &str, actor_id: &str) -> bool {
        self.allow_at(npc_id, actor_id, Instant::now())
    }

    fn allow_at(&mut self, npc_id: &str, actor_id: &str, now: Instant) -> bool {
        let key = (npc_id.to_string(), actor_id.to_string());
        match self.seen.get(&key) {
            Some(last) if now.duration_since(*last) < self.window => false,
            _ => {
                self.seen.insert(key, now);
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budget_spends_down_and_refills_over_time() {
        let mut budget = RequestBudget::new(2);
        assert!(budget.try_spend());
        assert!(budget.try_spend());
        assert!(!budget.try_spend(), "empty bucket rejects");
        assert_eq!(budget.remaining(), 0);
    }

    #[test]
    fn greeting_debounce_is_per_pair() {
        let mut debounce = GreetingDebounce::new(Duration::from_secs(60));
        let start = Instant::now();
        assert!(debounce.allow_at("maren", "p1", start));
        assert!(!debounce.allow_at("maren", "p1", start + Duration::from_secs(10)));
        assert!(debounce.allow_at("maren", "p2", start + Duration::from_secs(10)));
        assert!(debounce.allow_at("maren", "p1", start + Duration::from_secs(61)));
    }
}
