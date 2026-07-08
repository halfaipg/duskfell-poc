use std::time::Duration;

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionPreflight {
    pub account_subject: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SessionTicket {
    pub token: String,
    pub session_id: Uuid,
    pub display_name: Option<String>,
    pub account_subject: Option<String>,
    pub expires_in_seconds: u64,
}
