import assert from "node:assert/strict";
import test from "node:test";

import { parseServerMessage } from "./server-messages.js";
import { validPlayer, validSnapshot } from "./server-message-test-fixtures.js";

test("rejects snapshots with non-finite coordinates", () => {
  const snapshot = validSnapshot();
  snapshot.players[0].x = Number.NaN;

  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /players\[0\]\.x must be finite/,
  );
});

test("rejects snapshots with oversized player arrays", () => {
  const snapshot = validSnapshot();
  snapshot.players = Array.from({ length: 513 }, () => validPlayer());

  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /players exceeds maximum length/,
  );
});

test("rejects invalid resource counts", () => {
  const snapshot = validSnapshot();
  snapshot.players[0].resources.wood = 1000;

  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /resources\.wood exceeds maximum resource count/,
  );

  snapshot.players[0].resources.wood = 1;
  snapshot.players[0].resources.ore = -1;
  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /resources\.ore must be a non-negative integer/,
  );
});

test("rejects invalid inventory shape", () => {
  const snapshot = validSnapshot();
  snapshot.players[0].inventory.items[0].quantity = 1000;

  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /inventory\.items\[0\]\.quantity exceeds maximum resource count/,
  );

  snapshot.players[0] = validPlayer();
  snapshot.players[0].inventory.items.push({ itemId: "wood", label: "Wood", quantity: 1 });
  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /duplicate itemId wood/,
  );

  snapshot.players[0] = validPlayer();
  snapshot.players[0].inventory.capacitySlots = 33;
  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /capacitySlots exceeds maximum inventory slots/,
  );
});

test("parses inventory item lifecycle state", () => {
  const snapshot = validSnapshot();
  snapshot.players[0].inventory.items[0].lifecycle = {
    family: "wood",
    stage: "weathered",
    ageYears: 12,
    health: 0.82,
    decay: 0.26,
    compostable: false,
  };

  const message = parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot }));

  assert.deepEqual(message.players[0].inventory.items[0].lifecycle, {
    family: "wood",
    stage: "weathered",
    ageYears: 12,
    health: 0.82,
    decay: 0.26,
    compostable: false,
  });
});

test("rejects invalid inventory lifecycle shape", () => {
  const snapshot = validSnapshot();
  snapshot.players[0].inventory.items[0].lifecycle = {
    family: "wood",
    stage: "weathered",
    ageYears: 12,
    health: 0.82,
    decay: 2,
    compostable: false,
  };

  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /inventory\.items\[0\]\.lifecycle\.decay must be a unit number/,
  );

  snapshot.players[0].inventory.items[0].lifecycle.decay = 0.2;
  snapshot.players[0].inventory.items[0].lifecycle.compostable = "yes";
  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /inventory\.items\[0\]\.lifecycle\.compostable must be a boolean/,
  );
});
