import assert from "node:assert/strict";
import test from "node:test";

import { createNpcSpeech } from "./npc-speech.js";
import { parseServerMessage } from "./server-messages.js";

const SAY_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";

function frame(overrides = {}) {
  return {
    npcId: "maren",
    sayId: SAY_ID,
    seq: 0,
    text: "The ledger ",
    done: false,
    source: "canned",
    ...overrides,
  };
}

test("accumulates streamed deltas into one utterance", () => {
  const speech = createNpcSpeech();
  assert.equal(speech.handleFrame(frame(), 1000), null);
  const completed = speech.handleFrame(
    frame({ seq: 1, text: "doesn't read itself.", done: true }),
    1100,
  );
  assert.equal(completed.completed, "The ledger doesn't read itself.");
  assert.equal(completed.npcId, "maren");
  assert.equal(speech.logEntries().length, 1);
});

test("bubble shows while streaming and lingers after done", () => {
  const speech = createNpcSpeech();
  speech.handleFrame(frame(), 1000);
  assert.equal(speech.bubbleFor("maren", 1050), "The ledger ");
  speech.handleFrame(frame({ seq: 1, text: "rests.", done: true }), 1100);
  assert.equal(speech.bubbleFor("maren", 2000), "The ledger rests.");
  assert.equal(speech.bubbleFor("maren", 1100 + 20000), null);
});

test("longer replies linger longer than short ones", () => {
  const speech = createNpcSpeech();
  speech.handleFrame(frame({ text: "Mm.", done: true }), 1000);
  assert.equal(speech.bubbleFor("maren", 1000 + 5000), null, "short line expires");

  speech.handleFrame(
    frame({ sayId: "16fd2706-8baf-433b-82eb-8c7fada847da", text: "x".repeat(120), done: true }),
    1000,
  );
  assert.notEqual(speech.bubbleFor("maren", 1000 + 5000), null, "long line still visible");
});

test("thinking indicator shows after a say until the reply starts", () => {
  const speech = createNpcSpeech();
  speech.noteAwaitingReply("maren", 1000);
  const dots = speech.bubbleFor("maren", 1500);
  assert.match(dots, /^\.{1,3}$/);
  // First delta clears the indicator and shows real text.
  speech.handleFrame(frame(), 2000);
  assert.equal(speech.bubbleFor("maren", 2050), "The ledger ");
});

test("thinking indicator gives up after the timeout", () => {
  const speech = createNpcSpeech();
  speech.noteAwaitingReply("maren", 1000);
  assert.equal(speech.bubbleFor("maren", 1000 + 26000), null);
});

test("parseServerMessage validates npcSay frames", () => {
  const parsed = parseServerMessage(
    JSON.stringify({
      type: "npcSay",
      npcId: "maren",
      sayId: SAY_ID,
      seq: 0,
      text: "Mm.",
      done: true,
      source: "canned",
    }),
  );
  assert.equal(parsed.type, "npcSay");
  assert.equal(parsed.text, "Mm.");
  assert.equal(parsed.done, true);
});

test("parseServerMessage rejects malformed npcSay frames", () => {
  const base = {
    type: "npcSay",
    npcId: "maren",
    sayId: SAY_ID,
    seq: 0,
    text: "Mm.",
    done: true,
    source: "canned",
  };
  assert.throws(() => parseServerMessage(JSON.stringify({ ...base, source: "wild" })));
  assert.throws(() => parseServerMessage(JSON.stringify({ ...base, text: "x".repeat(300) })));
  assert.throws(() => parseServerMessage(JSON.stringify({ ...base, sayId: "nope" })));
  assert.throws(() => parseServerMessage(JSON.stringify({ ...base, seq: -1 })));
});
