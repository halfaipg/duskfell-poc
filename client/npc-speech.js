const MIN_BUBBLE_LINGER_MS = 4000;
const MAX_BUBBLE_LINGER_MS = 15000;
const BUBBLE_LINGER_PER_CHAR_MS = 50;
const AWAITING_REPLY_TIMEOUT_MS = 25000;
const MAX_LOG_ENTRIES = 30;
const MAX_UTTERANCE_CHARS = 2048;

// Accumulates streamed npcSay delta frames into per-NPC speech bubbles and a
// completed-line dialogue log, and tracks "thinking" state between the player
// sending a message and the NPC's first reply delta. Frames for one utterance
// share a sayId and arrive in order on the socket.
export function createNpcSpeech() {
  const active = new Map(); // sayId -> { npcId, text }
  const bubbles = new Map(); // npcId -> { text, updatedAt, done }
  const awaitingReply = new Map(); // npcId -> since
  const log = [];

  function noteAwaitingReply(npcId, now = Date.now()) {
    awaitingReply.set(npcId, now);
  }

  function handleFrame(frame, now = Date.now()) {
    awaitingReply.delete(frame.npcId);
    let entry = active.get(frame.sayId);
    if (!entry) {
      entry = { npcId: frame.npcId, text: "" };
      active.set(frame.sayId, entry);
    }
    if (entry.text.length + frame.text.length <= MAX_UTTERANCE_CHARS) {
      entry.text += frame.text;
    }
    bubbles.set(entry.npcId, { text: entry.text, updatedAt: now, done: frame.done });
    if (frame.done) {
      active.delete(frame.sayId);
      log.push({ npcId: entry.npcId, text: entry.text, source: frame.source, at: now });
      if (log.length > MAX_LOG_ENTRIES) {
        log.shift();
      }
      return { completed: entry.text, npcId: entry.npcId, source: frame.source };
    }
    return null;
  }

  function bubbleFor(npcId, now = Date.now()) {
    const since = awaitingReply.get(npcId);
    if (since != null) {
      if (now - since > AWAITING_REPLY_TIMEOUT_MS) {
        awaitingReply.delete(npcId);
      } else {
        // Animated thinking indicator until the first reply delta arrives.
        const dots = 1 + (Math.floor((now - since) / 400) % 3);
        return ".".repeat(dots);
      }
    }
    const bubble = bubbles.get(npcId);
    if (!bubble) return null;
    if (bubble.done && now - bubble.updatedAt > lingerFor(bubble.text)) {
      bubbles.delete(npcId);
      return null;
    }
    return bubble.text;
  }

  function logEntries() {
    return [...log];
  }

  return { handleFrame, bubbleFor, logEntries, noteAwaitingReply };
}

// Longer lines stay up longer so they can actually be read.
function lingerFor(text) {
  const scaled = MIN_BUBBLE_LINGER_MS + text.length * BUBBLE_LINGER_PER_CHAR_MS;
  return Math.min(MAX_BUBBLE_LINGER_MS, scaled);
}
