use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

use super::{
    token_key, SessionAccountRateLimiter, SessionAuth, SessionIssueError,
    SessionIssueRateLimitConfig, SessionIssueRateLimiter, SessionRejectReason, SessionTickets,
    MAX_SESSION_TOKEN_BYTES,
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
fn pending_tickets_are_keyed_by_token_hash() {
    let mut tickets = SessionTickets::new(Duration::from_secs(60), 8);
    let ticket = tickets.issue().expect("ticket issued");

    assert!(tickets.contains_token_key(&token_key(&ticket.token)));
    assert_eq!(tickets.pending_count(), 1);
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
    let oversized_token = "x".repeat(MAX_SESSION_TOKEN_BYTES + 1);

    assert_eq!(
        tickets.preflight_validate(None, true),
        Err(SessionRejectReason::Missing)
    );
    assert_eq!(
        tickets.preflight_validate(Some("not-a-ticket"), true),
        Err(SessionRejectReason::Invalid)
    );
    assert_eq!(
        tickets.preflight_validate(Some(&oversized_token), true),
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
fn oversized_ticket_is_rejected_without_consuming_good_ticket() {
    let mut tickets = SessionTickets::new(Duration::from_secs(60), 8);
    let ticket = tickets.issue().expect("ticket issued");
    let oversized_token = "x".repeat(MAX_SESSION_TOKEN_BYTES + 1);

    assert_eq!(
        tickets.validate(Some(&oversized_token), true),
        Err(SessionRejectReason::Invalid)
    );
    assert_eq!(tickets.pending_count(), 1);
    tickets
        .validate(Some(&ticket.token), true)
        .expect("valid ticket remains consumable");
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
fn preflight_returns_account_subject_without_consuming_ticket() {
    let mut tickets = SessionTickets::new(Duration::from_secs(60), 8);
    let ticket = tickets
        .issue_with_display_name_and_account(None, Some("acct:wallet:0xabc".to_string()))
        .expect("ticket issued");

    let preflight = tickets
        .preflight_validate(Some(&ticket.token), true)
        .expect("valid ticket passes preflight");
    assert_eq!(
        preflight.account_subject.as_deref(),
        Some("acct:wallet:0xabc")
    );
    assert_eq!(tickets.pending_count(), 1);
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
