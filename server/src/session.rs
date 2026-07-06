use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct SessionConfig {
    pub require_session: bool,
    pub ticket_ttl: Duration,
    pub ticket_capacity: usize,
}

#[derive(Debug, Clone)]
pub struct SessionIssueRateLimitConfig {
    pub requests_per_minute: u32,
    pub burst: u32,
    pub max_clients: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionAuth {
    AnonymousDev,
    Ticket {
        session_id: Uuid,
        display_name: Option<String>,
        account_subject: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionIssueError {
    CapacityReached,
    DisplayNameReserved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionRejectReason {
    Missing,
    Invalid,
    Expired,
}

#[derive(Debug, Clone)]
pub struct SessionTicket {
    pub token: String,
    pub session_id: Uuid,
    pub display_name: Option<String>,
    pub account_subject: Option<String>,
    pub expires_in_seconds: u64,
}

#[derive(Debug, Clone)]
struct StoredTicket {
    session_id: Uuid,
    display_name: Option<String>,
    account_subject: Option<String>,
    expires_at: Instant,
}

#[derive(Debug)]
pub struct SessionTickets {
    ttl: Duration,
    capacity: usize,
    tickets: HashMap<String, StoredTicket>,
}

impl SessionTickets {
    pub fn new(ttl: Duration, capacity: usize) -> Self {
        Self {
            ttl,
            capacity,
            tickets: HashMap::new(),
        }
    }

    #[cfg(test)]
    pub fn issue(&mut self) -> Result<SessionTicket, SessionIssueError> {
        self.issue_with_display_name(None)
    }

    #[cfg(test)]
    pub fn issue_with_display_name(
        &mut self,
        display_name: Option<String>,
    ) -> Result<SessionTicket, SessionIssueError> {
        self.issue_with_display_name_and_account(display_name, None)
    }

    pub fn issue_with_display_name_and_account(
        &mut self,
        display_name: Option<String>,
        account_subject: Option<String>,
    ) -> Result<SessionTicket, SessionIssueError> {
        let now = Instant::now();
        self.cleanup_expired(now);
        if self.tickets.len() >= self.capacity {
            return Err(SessionIssueError::CapacityReached);
        }
        if let Some(display_name) = display_name.as_deref() {
            if self.is_display_name_reserved(display_name) {
                return Err(SessionIssueError::DisplayNameReserved);
            }
        }

        let token = Uuid::new_v4().to_string();
        let session_id = Uuid::new_v4();
        self.tickets.insert(
            token.clone(),
            StoredTicket {
                session_id,
                display_name: display_name.clone(),
                account_subject: account_subject.clone(),
                expires_at: now + self.ttl,
            },
        );

        Ok(SessionTicket {
            token,
            session_id,
            display_name,
            account_subject,
            expires_in_seconds: self.ttl.as_secs(),
        })
    }

    pub fn validate(
        &mut self,
        token: Option<&str>,
        require_session: bool,
    ) -> Result<SessionAuth, SessionRejectReason> {
        let Some(token) = token.filter(|value| !value.is_empty()) else {
            return if require_session {
                Err(SessionRejectReason::Missing)
            } else {
                Ok(SessionAuth::AnonymousDev)
            };
        };

        let now = Instant::now();
        let Some(ticket) = self.tickets.remove(token) else {
            self.cleanup_expired(now);
            return Err(SessionRejectReason::Invalid);
        };

        self.cleanup_expired(now);
        if ticket.expires_at <= now {
            return Err(SessionRejectReason::Expired);
        }

        Ok(SessionAuth::Ticket {
            session_id: ticket.session_id,
            display_name: ticket.display_name,
            account_subject: ticket.account_subject,
        })
    }

    pub fn preflight_validate(
        &mut self,
        token: Option<&str>,
        require_session: bool,
    ) -> Result<(), SessionRejectReason> {
        let Some(token) = token.filter(|value| !value.is_empty()) else {
            return if require_session {
                Err(SessionRejectReason::Missing)
            } else {
                Ok(())
            };
        };

        let now = Instant::now();
        let Some(expires_at) = self.tickets.get(token).map(|ticket| ticket.expires_at) else {
            self.cleanup_expired(now);
            return Err(SessionRejectReason::Invalid);
        };

        self.cleanup_expired(now);
        if expires_at <= now {
            return Err(SessionRejectReason::Expired);
        }

        Ok(())
    }

    pub fn pending_count(&mut self) -> usize {
        self.cleanup_expired(Instant::now());
        self.tickets.len()
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    fn is_display_name_reserved(&self, display_name: &str) -> bool {
        let key = display_name_key(display_name);
        self.tickets
            .values()
            .filter_map(|ticket| ticket.display_name.as_deref())
            .any(|pending_name| display_name_key(pending_name) == key)
    }

    fn cleanup_expired(&mut self, now: Instant) {
        self.tickets.retain(|_, ticket| ticket.expires_at > now);
    }
}

fn display_name_key(display_name: &str) -> String {
    display_name.to_ascii_lowercase()
}

impl Default for SessionTickets {
    fn default() -> Self {
        Self::new(Duration::from_secs(120), 2048)
    }
}

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

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};
    use std::time::Duration;

    use super::{
        SessionAccountRateLimiter, SessionAuth, SessionIssueError, SessionIssueRateLimitConfig,
        SessionIssueRateLimiter, SessionRejectReason, SessionTickets,
    };

    #[test]
    fn issued_ticket_can_be_consumed_once() {
        let mut tickets = SessionTickets::new(Duration::from_secs(60), 8);
        let ticket = tickets.issue().expect("ticket issued");

        let auth = tickets
            .validate(Some(&ticket.token), true)
            .expect("ticket accepted");
        assert_eq!(
            auth,
            SessionAuth::Ticket {
                session_id: ticket.session_id,
                display_name: None,
                account_subject: None,
            }
        );

        assert_eq!(
            tickets.validate(Some(&ticket.token), true),
            Err(SessionRejectReason::Invalid)
        );
    }

    #[test]
    fn missing_ticket_is_allowed_only_in_dev_mode() {
        let mut tickets = SessionTickets::new(Duration::from_secs(60), 8);

        assert_eq!(tickets.validate(None, false), Ok(SessionAuth::AnonymousDev));
        assert_eq!(
            tickets.validate(None, true),
            Err(SessionRejectReason::Missing)
        );
    }

    #[test]
    fn ticket_capacity_limits_pending_sessions() {
        let mut tickets = SessionTickets::new(Duration::from_secs(60), 1);

        tickets.issue().expect("first ticket issued");
        assert_eq!(tickets.pending_count(), 1);
        assert_eq!(tickets.capacity(), 1);
        assert_eq!(
            tickets.issue().expect_err("capacity rejects second ticket"),
            SessionIssueError::CapacityReached
        );
    }

    #[test]
    fn issued_ticket_carries_display_name_once() {
        let mut tickets = SessionTickets::new(Duration::from_secs(60), 8);
        let ticket = tickets
            .issue_with_display_name(Some("Scout_7".to_string()))
            .expect("ticket issued");

        assert_eq!(ticket.display_name.as_deref(), Some("Scout_7"));
        assert_eq!(
            tickets
                .validate(Some(&ticket.token), true)
                .expect("ticket accepted"),
            SessionAuth::Ticket {
                session_id: ticket.session_id,
                display_name: Some("Scout_7".to_string()),
                account_subject: None,
            }
        );
        assert_eq!(
            tickets.validate(Some(&ticket.token), true),
            Err(SessionRejectReason::Invalid)
        );
    }

    #[test]
    fn issued_ticket_carries_account_subject_once() {
        let mut tickets = SessionTickets::new(Duration::from_secs(60), 8);
        let ticket = tickets
            .issue_with_display_name_and_account(
                Some("Scout_7".to_string()),
                Some("account:wallet:0xabc".to_string()),
            )
            .expect("ticket issued");

        assert_eq!(ticket.display_name.as_deref(), Some("Scout_7"));
        assert_eq!(
            ticket.account_subject.as_deref(),
            Some("account:wallet:0xabc")
        );
        assert_eq!(
            tickets
                .validate(Some(&ticket.token), true)
                .expect("ticket accepted"),
            SessionAuth::Ticket {
                session_id: ticket.session_id,
                display_name: Some("Scout_7".to_string()),
                account_subject: Some("account:wallet:0xabc".to_string()),
            }
        );
        assert_eq!(
            tickets.validate(Some(&ticket.token), true),
            Err(SessionRejectReason::Invalid)
        );
    }

    #[test]
    fn pending_ticket_display_names_are_reserved_until_consumed() {
        let mut tickets = SessionTickets::new(Duration::from_secs(60), 8);
        let ticket = tickets
            .issue_with_display_name(Some("Scout_7".to_string()))
            .expect("first display-name ticket issued");

        assert_eq!(
            tickets
                .issue_with_display_name(Some("scout_7".to_string()))
                .expect_err("pending display name is reserved"),
            SessionIssueError::DisplayNameReserved
        );
        assert!(tickets
            .issue_with_display_name(Some("Other_7".to_string()))
            .is_ok());
        tickets
            .validate(Some(&ticket.token), true)
            .expect("first ticket consumed");
        assert!(tickets
            .issue_with_display_name(Some("scout_7".to_string()))
            .is_ok());
    }

    #[test]
    fn preflight_validation_rejects_bad_tickets_without_consuming_good_tickets() {
        let mut tickets = SessionTickets::new(Duration::from_secs(60), 8);
        let ticket = tickets.issue().expect("ticket issued");

        assert_eq!(
            tickets.preflight_validate(None, true),
            Err(SessionRejectReason::Missing)
        );
        assert_eq!(
            tickets.preflight_validate(Some("not-a-ticket"), true),
            Err(SessionRejectReason::Invalid)
        );
        tickets
            .preflight_validate(Some(&ticket.token), true)
            .expect("valid ticket passes preflight");
        assert_eq!(tickets.pending_count(), 1);
        tickets
            .validate(Some(&ticket.token), true)
            .expect("valid ticket is still consumable");
    }

    #[test]
    fn preflight_validation_expires_stale_tickets() {
        let mut tickets = SessionTickets::new(Duration::ZERO, 8);
        let ticket = tickets.issue().expect("ticket issued");

        assert_eq!(
            tickets.preflight_validate(Some(&ticket.token), true),
            Err(SessionRejectReason::Expired)
        );
        assert_eq!(tickets.pending_count(), 0);
    }

    #[test]
    fn session_issue_rate_limit_is_per_client_ip() {
        let mut limiter = SessionIssueRateLimiter::new(SessionIssueRateLimitConfig {
            requests_per_minute: 60,
            burst: 2,
            max_clients: 8,
        });
        let first_ip = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        let second_ip = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 2));

        assert!(limiter.allow(first_ip));
        assert!(limiter.allow(first_ip));
        assert!(!limiter.allow(first_ip));
        assert!(limiter.allow(second_ip));
        assert_eq!(limiter.tracked_clients(), 2);
    }

    #[test]
    fn session_issue_rate_limit_caps_tracked_clients() {
        let mut limiter = SessionIssueRateLimiter::new(SessionIssueRateLimitConfig {
            requests_per_minute: 60,
            burst: 2,
            max_clients: 1,
        });
        let first_ip = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        let second_ip = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 2));

        assert!(limiter.allow(first_ip));
        assert!(!limiter.allow(second_ip));
        assert_eq!(limiter.tracked_clients(), 1);
        assert!(limiter.allow(first_ip));
    }

    #[test]
    fn session_account_rate_limit_is_per_subject() {
        let mut limiter = SessionAccountRateLimiter::new(SessionIssueRateLimitConfig {
            requests_per_minute: 60,
            burst: 2,
            max_clients: 8,
        });

        assert!(limiter.allow("acct:wallet:0xabc"));
        assert!(limiter.allow("acct:wallet:0xabc"));
        assert!(!limiter.allow("acct:wallet:0xabc"));
        assert!(limiter.allow("acct:wallet:0xdef"));
        assert_eq!(limiter.tracked_subjects(), 2);
    }

    #[test]
    fn session_account_rate_limit_caps_tracked_subjects() {
        let mut limiter = SessionAccountRateLimiter::new(SessionIssueRateLimitConfig {
            requests_per_minute: 60,
            burst: 2,
            max_clients: 1,
        });

        assert!(limiter.allow("acct:wallet:0xabc"));
        assert!(!limiter.allow("acct:wallet:0xdef"));
        assert_eq!(limiter.tracked_subjects(), 1);
        assert!(limiter.allow("acct:wallet:0xabc"));
    }
}
