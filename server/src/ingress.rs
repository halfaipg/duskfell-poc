use std::time::Instant;

pub const DEFAULT_MAX_CLIENT_TEXT_BYTES: usize = 4096;
pub const DEFAULT_MESSAGE_BURST: u32 = 20;
pub const DEFAULT_MESSAGE_REFILL_PER_SECOND: u32 = 30;

#[derive(Debug, Clone, PartialEq)]
pub struct ClientIngressConfig {
    pub max_text_bytes: usize,
    pub message_burst: u32,
    pub message_refill_per_second: u32,
}

impl Default for ClientIngressConfig {
    fn default() -> Self {
        Self {
            max_text_bytes: DEFAULT_MAX_CLIENT_TEXT_BYTES,
            message_burst: DEFAULT_MESSAGE_BURST,
            message_refill_per_second: DEFAULT_MESSAGE_REFILL_PER_SECOND,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum IngressRejectReason {
    MessageTooLarge { bytes: usize, max: usize },
    RateLimited,
    StaleInputSequence { seq: u64, last: u64 },
    UnsupportedBinaryFrame { bytes: usize },
}

impl IngressRejectReason {
    pub fn as_log_reason(&self) -> String {
        match self {
            Self::MessageTooLarge { bytes, max } => {
                format!("message-too-large bytes={bytes} max={max}")
            }
            Self::RateLimited => "rate-limited".to_string(),
            Self::StaleInputSequence { seq, last } => {
                format!("stale-input-sequence seq={seq} last={last}")
            }
            Self::UnsupportedBinaryFrame { bytes } => {
                format!("unsupported-binary-frame bytes={bytes}")
            }
        }
    }
}

#[derive(Debug)]
pub struct ClientIngress {
    config: ClientIngressConfig,
    tokens: f32,
    last_refill: Instant,
    last_input_seq: Option<u64>,
}

impl ClientIngress {
    pub fn new(config: ClientIngressConfig) -> Self {
        Self {
            tokens: config.message_burst as f32,
            config,
            last_refill: Instant::now(),
            last_input_seq: None,
        }
    }

    pub fn allow_text_frame(&mut self, bytes: usize) -> Result<(), IngressRejectReason> {
        if bytes > self.config.max_text_bytes {
            return Err(IngressRejectReason::MessageTooLarge {
                bytes,
                max: self.config.max_text_bytes,
            });
        }

        self.refill();
        if self.tokens < 1.0 {
            return Err(IngressRejectReason::RateLimited);
        }

        self.tokens -= 1.0;
        Ok(())
    }

    pub fn accept_input_sequence(&mut self, seq: u64) -> Result<(), IngressRejectReason> {
        if let Some(last) = self.last_input_seq {
            if seq <= last {
                return Err(IngressRejectReason::StaleInputSequence { seq, last });
            }
        }

        self.last_input_seq = Some(seq);
        Ok(())
    }

    pub fn reject_binary_frame(&mut self, bytes: usize) -> IngressRejectReason {
        IngressRejectReason::UnsupportedBinaryFrame { bytes }
    }

    fn refill(&mut self) {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill).as_secs_f32();
        self.last_refill = now;
        self.tokens = (self.tokens + elapsed * self.config.message_refill_per_second as f32)
            .min(self.config.message_burst as f32);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_oversized_text_frames() {
        let mut ingress = ClientIngress::new(ClientIngressConfig::default());
        let result = ingress.allow_text_frame(DEFAULT_MAX_CLIENT_TEXT_BYTES + 1);

        assert_eq!(
            result,
            Err(IngressRejectReason::MessageTooLarge {
                bytes: DEFAULT_MAX_CLIENT_TEXT_BYTES + 1,
                max: DEFAULT_MAX_CLIENT_TEXT_BYTES,
            })
        );
    }

    #[test]
    fn rejects_stale_input_sequences() {
        let mut ingress = ClientIngress::new(ClientIngressConfig::default());

        assert!(ingress.accept_input_sequence(7).is_ok());
        assert_eq!(
            ingress.accept_input_sequence(7),
            Err(IngressRejectReason::StaleInputSequence { seq: 7, last: 7 })
        );
        assert_eq!(
            ingress.accept_input_sequence(6),
            Err(IngressRejectReason::StaleInputSequence { seq: 6, last: 7 })
        );
        assert!(ingress.accept_input_sequence(8).is_ok());
    }

    #[test]
    fn rate_limits_large_bursts() {
        let config = ClientIngressConfig {
            max_text_bytes: DEFAULT_MAX_CLIENT_TEXT_BYTES,
            message_burst: 3,
            message_refill_per_second: DEFAULT_MESSAGE_REFILL_PER_SECOND,
        };
        let mut ingress = ClientIngress::new(config);
        for _ in 0..3 {
            assert!(ingress.allow_text_frame(16).is_ok());
        }

        assert_eq!(
            ingress.allow_text_frame(16),
            Err(IngressRejectReason::RateLimited)
        );
    }

    #[test]
    fn rejects_binary_frames_as_unsupported_protocol() {
        let mut ingress = ClientIngress::new(ClientIngressConfig::default());

        assert_eq!(
            ingress.reject_binary_frame(3),
            IngressRejectReason::UnsupportedBinaryFrame { bytes: 3 }
        );
    }
}
