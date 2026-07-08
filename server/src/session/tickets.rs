use std::collections::HashMap;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::model::{
    SessionAuth, SessionIssueError, SessionPreflight, SessionRejectReason, SessionTicket,
};

pub(crate) const MAX_SESSION_TOKEN_BYTES: usize = 128;

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
    tickets: HashMap<[u8; 32], StoredTicket>,
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
            token_key(&token),
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
        let Some(token) = normalize_token(token) else {
            return if require_session {
                Err(SessionRejectReason::Missing)
            } else {
                Ok(SessionAuth::AnonymousDev)
            };
        };
        if token.len() > MAX_SESSION_TOKEN_BYTES {
            return Err(SessionRejectReason::Invalid);
        }
        let key = token_key(token);

        let now = Instant::now();
        let Some(ticket) = self.tickets.remove(&key) else {
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
    ) -> Result<SessionPreflight, SessionRejectReason> {
        let Some(token) = normalize_token(token) else {
            return if require_session {
                Err(SessionRejectReason::Missing)
            } else {
                Ok(SessionPreflight {
                    account_subject: None,
                })
            };
        };
        if token.len() > MAX_SESSION_TOKEN_BYTES {
            return Err(SessionRejectReason::Invalid);
        }
        let key = token_key(token);

        let now = Instant::now();
        let Some(ticket) = self.tickets.get(&key) else {
            self.cleanup_expired(now);
            return Err(SessionRejectReason::Invalid);
        };
        let expires_at = ticket.expires_at;
        let account_subject = ticket.account_subject.clone();

        self.cleanup_expired(now);
        if expires_at <= now {
            return Err(SessionRejectReason::Expired);
        }

        Ok(SessionPreflight { account_subject })
    }

    pub fn pending_count(&mut self) -> usize {
        self.cleanup_expired(Instant::now());
        self.tickets.len()
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    #[cfg(test)]
    pub(crate) fn contains_token_key(&self, key: &[u8; 32]) -> bool {
        self.tickets.contains_key(key)
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

impl Default for SessionTickets {
    fn default() -> Self {
        Self::new(Duration::from_secs(120), 2048)
    }
}

fn display_name_key(display_name: &str) -> String {
    display_name.to_ascii_lowercase()
}

fn normalize_token(token: Option<&str>) -> Option<&str> {
    token.filter(|value| !value.is_empty())
}

pub(crate) fn token_key(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}
