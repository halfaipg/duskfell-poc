use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

use super::model::SessionIssueRateLimitConfig;

#[derive(Debug)]
pub struct SessionIssueRateLimiter {
    config: SessionIssueRateLimitConfig,
    buckets: HashMap<IpAddr, IssueBucket>,
}

#[derive(Debug)]
pub struct SessionAccountRateLimiter {
    config: SessionIssueRateLimitConfig,
    buckets: HashMap<String, IssueBucket>,
}

#[derive(Debug)]
struct IssueBucket {
    tokens: f64,
    last_refill: Instant,
    last_seen: Instant,
}

impl SessionIssueRateLimiter {
    pub fn new(config: SessionIssueRateLimitConfig) -> Self {
        Self {
            config,
            buckets: HashMap::new(),
        }
    }

    pub fn allow(&mut self, ip: IpAddr) -> bool {
        let now = Instant::now();
        self.cleanup_stale(now);
        let config = self.config.clone();
        if !self.buckets.contains_key(&ip) && self.buckets.len() >= config.max_clients {
            return false;
        }

        let bucket = self.buckets.entry(ip).or_insert_with(|| IssueBucket {
            tokens: config.burst as f64,
            last_refill: now,
            last_seen: now,
        });

        refill_bucket(&config, bucket, now);
        bucket.last_seen = now;
        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    pub fn tracked_clients(&mut self) -> usize {
        self.cleanup_stale(Instant::now());
        self.buckets.len()
    }

    fn cleanup_stale(&mut self, now: Instant) {
        self.buckets
            .retain(|_, bucket| now.duration_since(bucket.last_seen) < Duration::from_secs(600));
    }
}

impl SessionAccountRateLimiter {
    pub fn new(config: SessionIssueRateLimitConfig) -> Self {
        Self {
            config,
            buckets: HashMap::new(),
        }
    }

    pub fn allow(&mut self, account_subject: &str) -> bool {
        let now = Instant::now();
        self.cleanup_stale(now);
        let config = self.config.clone();
        if !self.buckets.contains_key(account_subject) && self.buckets.len() >= config.max_clients {
            return false;
        }

        let bucket = self
            .buckets
            .entry(account_subject.to_string())
            .or_insert_with(|| IssueBucket {
                tokens: config.burst as f64,
                last_refill: now,
                last_seen: now,
            });

        refill_bucket(&config, bucket, now);
        bucket.last_seen = now;
        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    pub fn tracked_subjects(&mut self) -> usize {
        self.cleanup_stale(Instant::now());
        self.buckets.len()
    }

    fn cleanup_stale(&mut self, now: Instant) {
        self.buckets
            .retain(|_, bucket| now.duration_since(bucket.last_seen) < Duration::from_secs(600));
    }
}

fn refill_bucket(config: &SessionIssueRateLimitConfig, bucket: &mut IssueBucket, now: Instant) {
    let elapsed_seconds = now.duration_since(bucket.last_refill).as_secs_f64();
    if elapsed_seconds <= 0.0 {
        return;
    }

    let refill = elapsed_seconds * config.requests_per_minute as f64 / 60.0;
    bucket.tokens = (bucket.tokens + refill).min(config.burst as f64);
    bucket.last_refill = now;
}
