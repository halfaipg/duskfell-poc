use std::sync::atomic::Ordering;

use crate::ingress::IngressRejectReason;

use super::{update_max, AppMetrics};

impl AppMetrics {
    pub fn active_connections(&self) -> u64 {
        self.active_connections.load(Ordering::Relaxed)
    }

    pub fn connection_opened(&self) {
        self.active_connections.fetch_add(1, Ordering::Relaxed);
        self.ws_connections_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn connection_closed(&self) {
        let _ =
            self.active_connections
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                    Some(value.saturating_sub(1))
                });
    }

    pub fn message_in(&self) {
        self.ws_messages_in_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn message_rejected(&self) {
        self.ws_messages_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn ingress_message_rejected(&self, reason: &IngressRejectReason) {
        self.message_rejected();
        match reason {
            IngressRejectReason::MessageTooLarge { .. } => self
                .ws_messages_rejected_message_too_large_total
                .fetch_add(1, Ordering::Relaxed),
            IngressRejectReason::RateLimited | IngressRejectReason::SayRateLimited => self
                .ws_messages_rejected_rate_limited_total
                .fetch_add(1, Ordering::Relaxed),
            IngressRejectReason::StaleInputSequence { .. } => self
                .ws_messages_rejected_stale_input_sequence_total
                .fetch_add(1, Ordering::Relaxed),
            IngressRejectReason::InputSequenceJump { .. } => self
                .ws_messages_rejected_input_sequence_jump_total
                .fetch_add(1, Ordering::Relaxed),
            IngressRejectReason::UnsupportedBinaryFrame { .. } => self
                .ws_messages_rejected_unsupported_binary_total
                .fetch_add(1, Ordering::Relaxed),
        };
    }

    pub fn npc_say_frame_sent(&self) {
        self.npc_say_frames_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn npc_say_dropped(&self) {
        self.npc_say_dropped_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn message_out(&self, bytes: usize) {
        let bytes = bytes as u64;
        self.ws_messages_out_total.fetch_add(1, Ordering::Relaxed);
        self.ws_bytes_out_total.fetch_add(bytes, Ordering::Relaxed);
        self.ws_message_bytes_last.store(bytes, Ordering::Relaxed);
        update_max(&self.ws_message_bytes_max, bytes);
    }

    pub fn snapshot_out(&self, bytes: usize) {
        let bytes_u64 = bytes as u64;
        self.ws_snapshots_sent_total.fetch_add(1, Ordering::Relaxed);
        self.ws_snapshot_bytes_last
            .store(bytes_u64, Ordering::Relaxed);
        update_max(&self.ws_snapshot_bytes_max, bytes_u64);
        self.message_out(bytes);
    }

    pub fn snapshot_visibility_observed(&self, players: usize, objects: usize) {
        let players = players as u64;
        let objects = objects as u64;
        self.ws_snapshot_players_last
            .store(players, Ordering::Relaxed);
        self.ws_snapshot_objects_last
            .store(objects, Ordering::Relaxed);
        update_max(&self.ws_snapshot_players_max, players);
        update_max(&self.ws_snapshot_objects_max, objects);
    }

    pub fn snapshot_payload_rejected(&self) {
        self.ws_snapshot_payload_rejected_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn send_error(&self) {
        self.ws_send_errors_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn heartbeat_ping(&self) {
        self.ws_heartbeat_pings_total
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn idle_timeout(&self) {
        self.ws_idle_timeouts_total.fetch_add(1, Ordering::Relaxed);
    }
}
