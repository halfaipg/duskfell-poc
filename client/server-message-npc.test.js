import assert from "node:assert/strict";
import test from "node:test";

import { normalizeNpc } from "./server-message-npc.js";
import { normalizeSnapshot } from "./server-message-snapshot.js";

const PLAYER_UUID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";

function validNpc(overrides = {}) {
  return {
    id: "maren",
    name: "Maren",
    x: 1600,
    y: 1032,
    radius: 20,
    ...overrides,
  };
}

test("normalizeNpc accepts a minimal npc without a party", () => {
  const npc = normalizeNpc(validNpc(), "npc");
  assert.equal(npc.id, "maren");
  assert.equal(npc.name, "Maren");
  assert.equal(npc.partyPlayerId, null);
});

test("normalizeNpc keeps a valid partyPlayerId", () => {
  const npc = normalizeNpc(validNpc({ partyPlayerId: PLAYER_UUID }), "npc");
  assert.equal(npc.partyPlayerId, PLAYER_UUID);
});

test("normalizeNpc rejects malformed fields", () => {
  assert.throws(() => normalizeNpc(validNpc({ x: "east" }), "npc"));
  assert.throws(() => normalizeNpc(validNpc({ radius: -3 }), "npc"));
  assert.throws(() => normalizeNpc(validNpc({ partyPlayerId: "not-a-uuid" }), "npc"));
  assert.throws(() => normalizeNpc(null, "npc"));
});

test("snapshot without npcs field normalizes to an empty list", () => {
  const snapshot = normalizeSnapshot(minimalSnapshot(), "snapshot");
  assert.deepEqual(snapshot.npcs, []);
});

test("snapshot npcs are normalized in place", () => {
  const raw = minimalSnapshot();
  raw.npcs = [validNpc()];
  const snapshot = normalizeSnapshot(raw, "snapshot");
  assert.equal(snapshot.npcs.length, 1);
  assert.equal(snapshot.npcs[0].id, "maren");
});

function minimalSnapshot() {
  return {
    tick: 1,
    map: {
      width: 3328,
      height: 2176,
      safeZoneRadius: 360,
      terrain: {
        profile: "duskfell-terrain-v1",
        seed: 7341,
        unitsPerTile: 64,
        tileWidth: 64,
        tileHeight: 64,
        heightScale: 6,
        minElevation: -1,
        maxElevation: 4,
        waterLevel: -1,
        maxWalkableStep: 1,
        materials: [
          "grass",
          "field",
          "dirt",
          "stone",
          "water",
          "settlement",
          "cobble",
          "rock",
          "ruin",
          "shore",
        ],
      },
    },
    players: [],
    objects: [],
    settlement: {
      chainEnabled: false,
      pendingJobs: 0,
      confirmedJobs: 0,
      ownedAssets: 0,
      latestReceipt: null,
    },
  };
}
