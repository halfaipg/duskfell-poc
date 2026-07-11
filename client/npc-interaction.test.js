import assert from "node:assert/strict";
import test from "node:test";

import { nearestNpc, npcPartyPrompt, NPC_TALK_RADIUS } from "./npc-interaction.js";

const ME = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const OTHER = "16fd2706-8baf-433b-82eb-8c7fada847da";

const maren = { id: "maren", name: "Maren", x: 100, y: 100, radius: 20, partyPlayerId: null };
const bram = { id: "bram", name: "Bram", x: 400, y: 100, radius: 20, partyPlayerId: null };

test("nearestNpc picks the closest npc inside talk radius", () => {
  const npc = nearestNpc([maren, bram], { x: 110, y: 100 });
  assert.equal(npc?.id, "maren");
});

test("nearestNpc ignores npcs beyond the talk radius", () => {
  const npc = nearestNpc([maren], { x: 100 + NPC_TALK_RADIUS + 1, y: 100 });
  assert.equal(npc, null);
});

test("nearestNpc handles missing input", () => {
  assert.equal(nearestNpc(null, { x: 0, y: 0 }), null);
  assert.equal(nearestNpc([maren], null), null);
});

test("npcPartyPrompt offers an invite for a free npc", () => {
  const prompt = npcPartyPrompt(maren, ME);
  assert.equal(prompt.action, "partyInvite");
  assert.match(prompt.label, /talk to Maren/);
  assert.match(prompt.label, /invite to party/);
});

test("npcPartyPrompt offers leave for the local party companion", () => {
  const prompt = npcPartyPrompt({ ...maren, partyPlayerId: ME }, ME);
  assert.equal(prompt.action, "partyLeave");
  assert.match(prompt.label, /part ways/);
});

test("npcPartyPrompt reports npcs traveling with someone else", () => {
  const prompt = npcPartyPrompt({ ...maren, partyPlayerId: OTHER }, ME);
  assert.equal(prompt.action, null);
  assert.match(prompt.label, /traveling with someone/);
});

test("npcPartyPrompt handles no npc", () => {
  assert.equal(npcPartyPrompt(null, ME), null);
});
