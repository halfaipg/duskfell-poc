use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use crate::metrics::AppMetrics;
use crate::protocol::{NoticeLevel, NpcSaySource, PlayerId, ServerMessage};

pub const MAX_NPC_SAY_FRAME_CHARS: usize = 256;
pub const MAX_NPC_SAY_TOTAL_CHARS: usize = 2048;
pub const NPC_SAY_ROUTE_CAPACITY: usize = 64;

/// Per-player outbound channels for event-style `npcSay` frames. The socket
/// task owns the receiving end; dialogue tasks push frames here and drop on
/// overflow — NPC speech must never block or backpressure the sim.
pub type NpcSayRoutes = Arc<Mutex<HashMap<PlayerId, mpsc::Sender<ServerMessage>>>>;

pub fn new_routes() -> NpcSayRoutes {
    Arc::new(Mutex::new(HashMap::new()))
}

pub async fn register_route(
    routes: &NpcSayRoutes,
    player_id: PlayerId,
) -> mpsc::Receiver<ServerMessage> {
    let (tx, rx) = mpsc::channel(NPC_SAY_ROUTE_CAPACITY);
    routes.lock().await.insert(player_id, tx);
    rx
}

pub async fn unregister_route(routes: &NpcSayRoutes, player_id: PlayerId) {
    routes.lock().await.remove(&player_id);
}

/// Delivers a system notice (party outcomes, range feedback) to one player's
/// dialogue surface over the same per-player channel as npcSay frames.
pub async fn send_notice(
    routes: &NpcSayRoutes,
    metrics: &AppMetrics,
    player_id: PlayerId,
    level: NoticeLevel,
    message: impl Into<String>,
) {
    deliver_frame(
        routes,
        metrics,
        player_id,
        ServerMessage::Notice {
            level,
            message: message.into(),
        },
    )
    .await;
}

/// Splits `text` into bounded `npcSay` delta frames for one utterance.
/// `chunk_chars` controls delta granularity (clamped to the frame cap);
/// smaller chunks give live replies a typing feel.
pub fn say_frames(
    npc_id: &str,
    say_id: Uuid,
    source: NpcSaySource,
    text: &str,
    chunk_chars: usize,
) -> Vec<ServerMessage> {
    let chunk_chars = chunk_chars.clamp(1, MAX_NPC_SAY_FRAME_CHARS);
    let chars: Vec<char> = text.chars().take(MAX_NPC_SAY_TOTAL_CHARS).collect();
    let chunks: Vec<String> = chars
        .chunks(chunk_chars)
        .map(|chunk| chunk.iter().collect())
        .collect();
    let total = chunks.len().max(1);
    chunks
        .into_iter()
        .enumerate()
        .map(|(index, chunk)| ServerMessage::NpcSay {
            npc_id: npc_id.to_string(),
            say_id,
            seq: index as u32,
            text: chunk,
            done: index + 1 == total,
            source,
        })
        .collect()
}

/// Delivers one frame to the target player's socket channel. Drops (and
/// counts) when the player is gone or their channel is full.
pub async fn deliver_frame(
    routes: &NpcSayRoutes,
    metrics: &AppMetrics,
    player_id: PlayerId,
    frame: ServerMessage,
) {
    let sender = routes.lock().await.get(&player_id).cloned();
    match sender {
        Some(sender) => {
            if sender.try_send(frame).is_err() {
                metrics.npc_say_dropped();
            }
        }
        None => metrics.npc_say_dropped(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame_text(frame: &ServerMessage) -> (&str, bool, u32) {
        match frame {
            ServerMessage::NpcSay {
                text, done, seq, ..
            } => (text.as_str(), *done, *seq),
            other => panic!("expected npcSay frame, got {other:?}"),
        }
    }

    #[test]
    fn short_text_is_a_single_done_frame() {
        let frames = say_frames(
            "maren",
            Uuid::new_v4(),
            NpcSaySource::Canned,
            "Mm.",
            MAX_NPC_SAY_FRAME_CHARS,
        );
        assert_eq!(frames.len(), 1);
        let (text, done, seq) = frame_text(&frames[0]);
        assert_eq!(text, "Mm.");
        assert!(done);
        assert_eq!(seq, 0);
    }

    #[test]
    fn long_text_is_chunked_with_ordered_seq_and_final_done() {
        let text = "x".repeat(MAX_NPC_SAY_FRAME_CHARS * 2 + 10);
        let frames = say_frames(
            "maren",
            Uuid::new_v4(),
            NpcSaySource::Live,
            &text,
            MAX_NPC_SAY_FRAME_CHARS,
        );
        assert_eq!(frames.len(), 3);
        for (index, frame) in frames.iter().enumerate() {
            let (chunk, done, seq) = frame_text(frame);
            assert_eq!(seq, index as u32);
            assert_eq!(done, index == 2);
            assert!(chunk.chars().count() <= MAX_NPC_SAY_FRAME_CHARS);
        }
    }

    #[test]
    fn utterances_are_capped_at_total_chars() {
        let text = "y".repeat(MAX_NPC_SAY_TOTAL_CHARS * 2);
        let frames = say_frames(
            "maren",
            Uuid::new_v4(),
            NpcSaySource::Live,
            &text,
            MAX_NPC_SAY_FRAME_CHARS,
        );
        let total: usize = frames
            .iter()
            .map(|frame| frame_text(frame).0.chars().count())
            .sum();
        assert_eq!(total, MAX_NPC_SAY_TOTAL_CHARS);
    }
}
