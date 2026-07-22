use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use tokio::sync::{watch, Mutex};
use tracing::info;

use crate::EngineStatus;

use super::{CompletionReply, CompletionRequest, ProviderError};

const MODELS_PROBE_INTERVAL: Duration = Duration::from_secs(60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_STREAM_BYTES: usize = 128 * 1024;
const MAX_RESPONSE_BYTES: usize = 16 * 1024;
const MAX_SSE_BUFFER_BYTES: usize = 32 * 1024;

/// Any OpenAI-compatible chat-completions backend, consumed as SSE.
/// First-party target is AI Power Grid: a community GPU network whose models
/// come and go with workers, so the model id is discovered via `/v1/models`
/// unless pinned by config, and an empty model list means "no workers" —
/// degrade, don't hammer.
#[derive(Debug)]
pub struct OpenAiCompatibleProvider {
    client: reqwest::Client,
    base_url: String,
    api_key: String,
    configured_model: Option<String>,
    healthy: Arc<AtomicBool>,
    discovered_model: Arc<Mutex<Option<String>>>,
    status_rx: watch::Receiver<EngineStatus>,
}

impl OpenAiCompatibleProvider {
    /// Builds the provider and spawns its health probe on the current runtime.
    pub fn spawn(base_url: String, api_key: String, model: Option<String>) -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .expect("reqwest client builds with static config");
        let healthy = Arc::new(AtomicBool::new(false));
        let discovered_model = Arc::new(Mutex::new(None));
        let (status_tx, status_rx) = watch::channel(EngineStatus::Degraded {
            reason: "probing provider".to_string(),
        });

        {
            let client = client.clone();
            let base_url = base_url.clone();
            let api_key = api_key.clone();
            let healthy = healthy.clone();
            let discovered_model = discovered_model.clone();
            tokio::spawn(async move {
                run_models_probe(
                    client,
                    base_url,
                    api_key,
                    healthy,
                    discovered_model,
                    status_tx,
                )
                .await;
            });
        }

        Self {
            client,
            base_url,
            api_key,
            configured_model: model,
            healthy,
            discovered_model,
            status_rx,
        }
    }

    /// Health transitions for the engine to forward as StatusChanged.
    pub fn status_watch(&self) -> watch::Receiver<EngineStatus> {
        self.status_rx.clone()
    }

    pub async fn complete(
        &self,
        request: &CompletionRequest,
    ) -> Result<CompletionReply, ProviderError> {
        if !self.healthy.load(Ordering::Relaxed) {
            return Err(ProviderError::Unavailable {
                reason: "provider degraded (no workers or unreachable)".to_string(),
            });
        }
        let model = match &self.configured_model {
            Some(model) => model.clone(),
            None => self.discovered_model.lock().await.clone().ok_or_else(|| {
                ProviderError::Unavailable {
                    reason: "no model discovered".to_string(),
                }
            })?,
        };

        let body = serde_json::json!({
            "model": model,
            "stream": true,
            "max_tokens": request.max_tokens,
            "messages": [
                { "role": "system", "content": request.prompt.system_stable },
                { "role": "user", "content": request.prompt.user_turn },
            ],
        });

        self.attempt(&body).await
    }

    async fn attempt(&self, body: &serde_json::Value) -> Result<CompletionReply, ProviderError> {
        let response = self
            .client
            .post(format!("{}/v1/chat/completions", self.base_url))
            .bearer_auth(&self.api_key)
            .json(body)
            .send()
            .await
            .map_err(|err| ProviderError::Unavailable {
                reason: format!("request failed: {err}"),
            })?;

        let status = response.status();
        if status.as_u16() == 429 {
            return Err(ProviderError::RateLimited);
        }
        if status.is_server_error() {
            return Err(ProviderError::Unavailable {
                reason: format!("provider returned {status}"),
            });
        }
        if !status.is_success() {
            return Err(ProviderError::Failed {
                reason: format!("provider returned {status}"),
            });
        }

        let mut parser = SseCompletionParser::default();
        let mut stream = response.bytes_stream();
        let mut stream_bytes = 0usize;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|err| ProviderError::Unavailable {
                reason: format!("stream failed: {err}"),
            })?;
            stream_bytes = stream_bytes.saturating_add(chunk.len());
            if stream_bytes > MAX_STREAM_BYTES {
                return Err(ProviderError::Failed {
                    reason: "provider stream exceeded response byte limit".to_string(),
                });
            }
            parser.feed(&chunk);
            if parser.text.len() > MAX_RESPONSE_BYTES || parser.buffer.len() > MAX_SSE_BUFFER_BYTES
            {
                return Err(ProviderError::Failed {
                    reason: "provider response exceeded parsed output limit".to_string(),
                });
            }
            if parser.done {
                break;
            }
        }
        let text = parser.text;
        // Providers that omit usage still need budget metering: ~4 chars/token.
        let tokens_used = parser
            .usage_total_tokens
            .unwrap_or_else(|| ((text.len() as u64) / 4).max(1));
        Ok(CompletionReply { text, tokens_used })
    }
}

/// Incremental parser for OpenAI-style SSE chat completions: `data: {json}`
/// lines carrying `choices[0].delta.content`, terminated by `data: [DONE]`.
#[derive(Debug, Default)]
pub struct SseCompletionParser {
    buffer: String,
    pub text: String,
    pub usage_total_tokens: Option<u64>,
    pub done: bool,
}

impl SseCompletionParser {
    pub fn feed(&mut self, chunk: &[u8]) {
        self.buffer.push_str(&String::from_utf8_lossy(chunk));
        while let Some(newline) = self.buffer.find('\n') {
            let line: String = self.buffer.drain(..=newline).collect();
            self.handle_line(line.trim_end());
        }
    }

    fn handle_line(&mut self, line: &str) {
        let Some(data) = line.strip_prefix("data:") else {
            return;
        };
        let data = data.trim();
        if data == "[DONE]" {
            self.done = true;
            return;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
            return;
        };
        if let Some(content) = value
            .pointer("/choices/0/delta/content")
            .and_then(|content| content.as_str())
        {
            self.text.push_str(content);
        }
        // Non-streaming fallbacks put the whole message in one payload.
        if let Some(content) = value
            .pointer("/choices/0/message/content")
            .and_then(|content| content.as_str())
        {
            self.text.push_str(content);
        }
        if let Some(total) = value
            .pointer("/usage/total_tokens")
            .and_then(|total| total.as_u64())
        {
            self.usage_total_tokens = Some(total);
        }
    }
}

async fn run_models_probe(
    client: reqwest::Client,
    base_url: String,
    api_key: String,
    healthy: Arc<AtomicBool>,
    discovered_model: Arc<Mutex<Option<String>>>,
    status_tx: watch::Sender<EngineStatus>,
) {
    loop {
        let status = match probe_models(&client, &base_url, &api_key).await {
            Ok(models) if models.is_empty() => {
                healthy.store(false, Ordering::Relaxed);
                EngineStatus::Degraded {
                    reason: "no models on the grid (no workers)".to_string(),
                }
            }
            Ok(models) => {
                *discovered_model.lock().await = models.first().cloned();
                healthy.store(true, Ordering::Relaxed);
                EngineStatus::Live
            }
            Err(reason) => {
                healthy.store(false, Ordering::Relaxed);
                EngineStatus::Degraded { reason }
            }
        };
        let changed = *status_tx.borrow() != status;
        if changed {
            info!(status = %status.detail(), "provider health changed");
            let _ = status_tx.send(status);
        }
        tokio::time::sleep(MODELS_PROBE_INTERVAL).await;
    }
}

async fn probe_models(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
) -> Result<Vec<String>, String> {
    let response = client
        .get(format!("{base_url}/v1/models"))
        .bearer_auth(api_key)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|err| format!("models probe failed: {err}"))?;
    if !response.status().is_success() {
        return Err(format!("models probe returned {}", response.status()));
    }
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|err| format!("models probe body invalid: {err}"))?;
    let models = value
        .get("data")
        .and_then(|data| data.as_array())
        .map(|models| {
            models
                .iter()
                .filter_map(|model| model.get("id").and_then(|id| id.as_str()))
                .map(|id| id.to_string())
                .collect()
        })
        .unwrap_or_default();
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_streamed_deltas_until_done() {
        let mut parser = SseCompletionParser::default();
        parser.feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n");
        parser.feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n");
        parser.feed(b"data: [DONE]\n");
        assert_eq!(parser.text, "Hello");
        assert!(parser.done);
    }

    #[test]
    fn handles_lines_split_across_chunks() {
        let mut parser = SseCompletionParser::default();
        parser.feed(b"data: {\"choices\":[{\"delta\":");
        parser.feed(b"{\"content\":\"split\"}}]}\n");
        parser.feed(b"data: [DO");
        parser.feed(b"NE]\n");
        assert_eq!(parser.text, "split");
        assert!(parser.done);
    }

    #[test]
    fn captures_usage_and_ignores_noise() {
        let mut parser = SseCompletionParser::default();
        parser.feed(b": keep-alive comment\n");
        parser.feed(b"event: message\n");
        parser.feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n");
        parser.feed(b"data: {\"choices\":[],\"usage\":{\"total_tokens\":42}}\n");
        parser.feed(b"data: [DONE]\n");
        assert_eq!(parser.text, "x");
        assert_eq!(parser.usage_total_tokens, Some(42));
    }

    #[test]
    fn accepts_non_streaming_message_payloads() {
        let mut parser = SseCompletionParser::default();
        parser.feed(
            b"data: {\"choices\":[{\"message\":{\"content\":\"whole reply\"}}]}\ndata: [DONE]\n",
        );
        assert_eq!(parser.text, "whole reply");
        assert!(parser.done);
    }

    #[test]
    fn malformed_json_lines_are_skipped() {
        let mut parser = SseCompletionParser::default();
        parser.feed(b"data: {not json}\n");
        parser.feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n");
        assert_eq!(parser.text, "ok");
    }
}
