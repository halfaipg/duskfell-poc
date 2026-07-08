use std::sync::atomic::Ordering;

use super::AppMetrics;

impl AppMetrics {
    pub fn session_ticket_issued(&self) {
        self.session_tickets_issued_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_ticket_rejected(&self) {
        self.session_ticket_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_ticket_capacity_rejected(&self) {
        self.session_ticket_capacity_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_request_invalid(&self) {
        self.session_request_invalid_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_issue_rate_limited(&self) {
        self.session_issue_rate_limited_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_account_rate_limited(&self) {
        self.session_account_rate_limited_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_draining_rejected(&self) {
        self.session_draining_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_display_name_invalid(&self) {
        self.session_display_name_invalid_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_display_name_conflict(&self) {
        self.session_display_name_conflict_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn account_auth_rejected(&self) {
        self.account_auth_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn admin_auth_rejected(&self) {
        self.admin_auth_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn metrics_auth_rejected(&self) {
        self.metrics_auth_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn origin_rejected(&self) {
        self.origin_rejected_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn ws_capacity_rejected(&self) {
        self.ws_capacity_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn ws_peer_capacity_rejected(&self) {
        self.ws_peer_capacity_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn ws_account_capacity_rejected(&self) {
        self.ws_account_capacity_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn admin_snapshot_payload_rejected(&self) {
        self.admin_snapshot_payload_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }
}
