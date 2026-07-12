use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc;
use uuid::Uuid;

use crate::content::PersonaContent;
use crate::metrics::AppMetrics;
use crate::protocol::{NpcSaySource, PlayerId};

use super::egress::{deliver_frame, say_frames, NpcSayRoutes};

pub const SPEECH_QUEUE_CAPACITY: usize = 64;
const CANNED_DELTA_PACING: Duration = Duration::from_millis(120);
const CANNED_CHUNK_CHARS: usize = 96;
const LIVE_DELTA_PACING: Duration = Duration::from_millis(60);
const LIVE_CHUNK_CHARS: usize = 48;

/// A validated, journaled player utterance handed to the dialogue backend.
#[derive(Debug, Clone)]
pub struct SpeechRequest {
    pub player_id: PlayerId,
    pub npc_id: String,
    pub persona_id: String,
    // Unused by the canned responder; the cognition engine (stage 3) prompts with it.
    #[allow(dead_code)]
    pub text: String,
}

/// The reply a dialogue backend produced, reported back for journaling.
#[derive(Debug, Clone)]
pub struct SpokenReply {
    pub player_id: PlayerId,
    pub npc_id: String,
    pub say_id: Uuid,
    pub chars: usize,
    pub source: NpcSaySource,
}

/// Spawns the canned dialogue responder: picks a persona canned line
/// round-robin and streams it to the target player as paced `npcSay` deltas.
/// This is both the stage-2 backend and the permanent engine-off/degraded
/// fallback. Returns the request sender and a receiver of spoken replies
/// (for journaling by the caller).
pub fn spawn_canned_responder(
    personas: Arc<HashMap<String, PersonaContent>>,
    routes: NpcSayRoutes,
    metrics: Arc<AppMetrics>,
) -> (mpsc::Sender<SpeechRequest>, mpsc::Receiver<SpokenReply>) {
    let (request_tx, mut request_rx) = mpsc::channel::<SpeechRequest>(SPEECH_QUEUE_CAPACITY);
    let (reply_tx, reply_rx) = mpsc::channel::<SpokenReply>(SPEECH_QUEUE_CAPACITY);

    tokio::spawn(async move {
        let mut round_robin: HashMap<String, usize> = HashMap::new();
        while let Some(request) = request_rx.recv().await {
            let Some(persona) = personas.get(&request.persona_id) else {
                metrics.npc_say_dropped();
                continue;
            };
            let line = pick_canned_line(persona, &mut round_robin, &request.npc_id);
            let say_id = Uuid::new_v4();
            let frames = say_frames(
                &request.npc_id,
                say_id,
                NpcSaySource::Canned,
                &line,
                CANNED_CHUNK_CHARS,
            );
            let mut delivered_chars = 0usize;
            for frame in frames {
                if let crate::protocol::ServerMessage::NpcSay { text, .. } = &frame {
                    delivered_chars += text.chars().count();
                }
                deliver_frame(&routes, &metrics, request.player_id, frame).await;
                metrics.npc_say_frame_sent();
                tokio::time::sleep(CANNED_DELTA_PACING).await;
            }
            let _ = reply_tx.try_send(SpokenReply {
                player_id: request.player_id,
                npc_id: request.npc_id,
                say_id,
                chars: delivered_chars,
                source: NpcSaySource::Canned,
            });
        }
    });

    (request_tx, reply_rx)
}

/// Streams one engine-produced reply to the target player as small paced
/// deltas (typing feel) and returns the delivery record for journaling.
pub async fn stream_reply(
    routes: &NpcSayRoutes,
    metrics: &AppMetrics,
    player_id: PlayerId,
    npc_id: &str,
    source: NpcSaySource,
    text: &str,
) -> SpokenReply {
    let say_id = Uuid::new_v4();
    let frames = say_frames(npc_id, say_id, source, text, LIVE_CHUNK_CHARS);
    let mut delivered_chars = 0usize;
    for frame in frames {
        if let crate::protocol::ServerMessage::NpcSay { text, .. } = &frame {
            delivered_chars += text.chars().count();
        }
        deliver_frame(routes, metrics, player_id, frame).await;
        metrics.npc_say_frame_sent();
        tokio::time::sleep(LIVE_DELTA_PACING).await;
    }
    SpokenReply {
        player_id,
        npc_id: npc_id.to_string(),
        say_id,
        chars: delivered_chars,
        source,
    }
}

/// Journals every reply a dialogue backend delivered. Runs as its own task so
/// dialogue backends never need journal handles.
pub async fn journal_spoken_replies(
    state: crate::AppState,
    mut replies: mpsc::Receiver<SpokenReply>,
) {
    use crate::journal::JournalEventKind;
    use crate::tick_loop::record_journal;

    while let Some(reply) = replies.recv().await {
        let tick = state.sim.lock().await.tick_count();
        let source = match reply.source {
            NpcSaySource::Canned => "canned",
            NpcSaySource::Live => "live",
        };
        record_journal(
            &state,
            tick,
            JournalEventKind::NpcSaid {
                player_id: reply.player_id,
                npc_id: reply.npc_id,
                say_id: reply.say_id,
                chars: reply.chars,
                source: source.to_string(),
            },
        )
        .await;
    }
}

fn pick_canned_line(
    persona: &PersonaContent,
    round_robin: &mut HashMap<String, usize>,
    npc_id: &str,
) -> String {
    let lines = &persona.cognition.canned;
    let index = round_robin.entry(npc_id.to_string()).or_insert(0);
    let line = lines[*index % lines.len()].clone();
    *index = (*index + 1) % lines.len();
    line
}
