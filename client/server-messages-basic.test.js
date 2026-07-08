import assert from "node:assert/strict";
import test from "node:test";

import { parseServerMessage } from "./server-messages.js";
import { PLAYER_ID, validSnapshot, validTerrain } from "./server-message-test-fixtures.js";

test("parses a valid welcome message with normalized snapshot", () => {
  const message = parseServerMessage(
    JSON.stringify({
      type: "welcome",
      playerId: PLAYER_ID,
      snapshot: validSnapshot(),
    }),
  );

  assert.equal(message.type, "welcome");
  assert.equal(message.playerId, PLAYER_ID);
  assert.equal(message.snapshot.players[0].id, PLAYER_ID);
  assert.equal(message.snapshot.players[0].accountSubject, "acct:wallet:0xabc123");
  assert.deepEqual(message.snapshot.players[0].resources, {
    wood: 2,
    ore: 1,
    stone: 0,
    charge: 0,
    deadwood: 0,
    fiber: 0,
    mycelium: 0,
    spores: 0,
    seed: 0,
  });
  assert.deepEqual(message.snapshot.map.terrain, validTerrain());
  assert.deepEqual(message.snapshot.players[0].inventory, {
    capacitySlots: 8,
    items: [
      { itemId: "wood", label: "Wood", quantity: 2 },
      { itemId: "ore", label: "Ore", quantity: 1 },
    ],
  });
  assert.equal(message.snapshot.settlement.chainEnabled, false);
});

test("parses a valid snapshot message", () => {
  const message = parseServerMessage(
    JSON.stringify({
      type: "snapshot",
      ...validSnapshot(),
    }),
  );

  assert.equal(message.type, "snapshot");
  assert.equal(message.tick, 42);
  assert.equal(message.objects[0].kind, "registrar");
  assert.equal(message.objects[1].kind, "forge");
  assert.deepEqual(message.objects[2].resources, [{ kind: "wood", amount: 8, maxAmount: 12 }]);
  assert.deepEqual(message.objects[2].lifecycle, {
    family: "tree",
    stage: "mature",
    species: "ashbark",
    ageYears: 84,
    health: 0.77,
    growth: 0.67,
    decay: 0.15,
  });
  assert.equal(message.objects[3].kind, "myceliumPatch");
  assert.deepEqual(message.objects[3].resources, [{ kind: "mycelium", amount: 3, maxAmount: 4 }]);
  assert.equal(message.objects[4].kind, "fieldCoil");
  assert.deepEqual(message.objects[4].resources, [{ kind: "charge", amount: 3, maxAmount: 5 }]);
  assert.deepEqual(message.objects[4].lifecycle, {
    family: "machine",
    stage: "sparking",
    species: null,
    ageYears: 12,
    health: 0.49,
    growth: 0.6,
    decay: 0.08,
  });
  assert.equal(message.objects[5].kind, "ruin");
  assert.deepEqual(message.objects[5].resources, [{ kind: "stone", amount: 2, maxAmount: 12 }]);
  assert.deepEqual(message.objects[5].lifecycle, {
    family: "mineral",
    stage: "ancient-ruin",
    species: "sunken-viaduct-stone",
    ageYears: 128000,
    health: 0.24,
    growth: 0.17,
    decay: 0.6,
  });
});

test("rejects malformed JSON and unsupported message types", () => {
  assert.throws(() => parseServerMessage("{nope"), /not valid JSON/);
  assert.throws(() => parseServerMessage(JSON.stringify({ type: "teleport" })), /unsupported/);
});

test("parses bounded notice messages", () => {
  assert.deepEqual(parseServerMessage(JSON.stringify({ type: "notice", level: "warn", message: "Careful" })), {
    type: "notice",
    level: "warn",
    message: "Careful",
  });
});
