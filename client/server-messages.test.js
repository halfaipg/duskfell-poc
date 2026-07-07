import assert from "node:assert/strict";
import test from "node:test";

import { parseServerMessage } from "./server-messages.js";

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

test("rejects unsupported object kinds", () => {
  const snapshot = validSnapshot();
  snapshot.objects[0].kind = "portal";

  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /objects\[0\]\.kind is not supported/,
  );
});

test("rejects invalid object lifecycle resource shape", () => {
  const snapshot = validSnapshot();
  snapshot.objects[2].resources[0].kind = "moonPearl";

  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /objects\[2\]\.resources\[0\]\.kind is not supported/,
  );

  snapshot.objects[2] = validGroveObject();
  snapshot.objects[2].resources[0].amount = 13;
  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /objects\[2\]\.resources\[0\]\.amount must be <= maxAmount/,
  );

  snapshot.objects[2] = validGroveObject();
  snapshot.objects[2].lifecycle.growth = 1.2;
  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /objects\[2\]\.lifecycle\.growth must be a unit number/,
  );
});

test("rejects unsupported terrain profiles and projection drift", () => {
  const snapshot = validSnapshot();
  snapshot.map.terrain.profile = "other-terrain";

  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /terrain\.profile is not supported/,
  );

  snapshot.map.terrain = validTerrain();
  snapshot.map.terrain.tileHeight = 32;
  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /terrain projection does not match/,
  );

  snapshot.map.terrain = validTerrain();
  snapshot.map.terrain.materials[0] = "lava";
  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /unsupported material lava/,
  );
});

test("rejects invalid settlement receipt shape", () => {
  const snapshot = validSnapshot();
  snapshot.settlement.latestReceipt = {
    jobId: RECEIPT_ID,
    playerId: PLAYER_ID,
    accountSubject: "acct:wallet:0xabc123",
    assetId: "dryrun-deed-test",
    status: "",
    chainTx: null,
  };

  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /latestReceipt\.status must be a bounded string/,
  );

  snapshot.settlement.latestReceipt = {
    jobId: RECEIPT_ID,
    playerId: PLAYER_ID,
    accountSubject: "",
    assetId: "dryrun-deed-test",
    status: "dry-run-confirmed:registrar-demo-deed",
    chainTx: null,
  };
  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /latestReceipt\.accountSubject must be a bounded string/,
  );
});

test("parses bounded notice messages", () => {
  assert.deepEqual(parseServerMessage(JSON.stringify({ type: "notice", level: "warn", message: "Careful" })), {
    type: "notice",
    level: "warn",
    message: "Careful",
  });
});

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const RECEIPT_ID = "22222222-2222-4222-8222-222222222222";

function validSnapshot() {
  return {
    tick: 42,
    map: {
      width: 1600,
      height: 1200,
      safeZoneRadius: 220,
      terrain: validTerrain(),
    },
    players: [validPlayer()],
    objects: [
      {
        id: "title-office",
        kind: "registrar",
        label: "Title Office",
        x: 760,
        y: 620,
        radius: 48,
      },
      {
        id: "field-forge",
        kind: "forge",
        label: "Field Forge",
        x: 900,
        y: 700,
        radius: 56,
      },
      validGroveObject(),
      {
        id: "shrine-mycelium-bloom",
        kind: "myceliumPatch",
        label: "Mycelium Bloom",
        x: 1018,
        y: 342,
        radius: 30,
        resources: [{ kind: "mycelium", amount: 3, maxAmount: 4 }],
        lifecycle: {
          family: "mycelium",
          stage: "fruiting",
          species: "veilcap",
          ageYears: 1,
          health: 0.85,
          growth: 0.75,
          decay: 0.74,
        },
      },
      {
        id: "field-coil",
        kind: "fieldCoil",
        label: "Field Coil",
        x: 1205,
        y: 540,
        radius: 34,
        resources: [{ kind: "charge", amount: 3, maxAmount: 5 }],
        lifecycle: {
          family: "machine",
          stage: "sparking",
          ageYears: 12,
          health: 0.49,
          growth: 0.6,
          decay: 0.08,
        },
      },
      {
        id: "ancient-viaduct-ruin",
        kind: "ruin",
        label: "Ancient Viaduct Ruin",
        x: 690,
        y: 372,
        radius: 42,
        resources: [{ kind: "stone", amount: 2, maxAmount: 12 }],
        lifecycle: {
          family: "mineral",
          stage: "ancient-ruin",
          species: "sunken-viaduct-stone",
          ageYears: 128000,
          health: 0.24,
          growth: 0.17,
          decay: 0.6,
        },
      },
    ],
    settlement: {
      chainEnabled: false,
      pendingJobs: 0,
      confirmedJobs: 1,
      ownedAssets: 1,
      latestReceipt: null,
    },
  };
}

function validTerrain() {
  return {
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
    materials: ["grass", "field", "dirt", "stone", "water", "settlement"],
  };
}

function validPlayer() {
  return {
    id: PLAYER_ID,
    accountSubject: "acct:wallet:0xabc123",
    name: "Wayfarer",
    x: 720,
    y: 640,
    color: "#2f7565",
    demoDeeds: [],
    resources: {
      wood: 2,
      ore: 1,
    },
    inventory: {
      capacitySlots: 8,
      items: [
        { itemId: "wood", label: "Wood", quantity: 2 },
        { itemId: "ore", label: "Ore", quantity: 1 },
      ],
    },
  };
}

function validGroveObject() {
  return {
    id: "north-grove",
    kind: "grove",
    label: "Ashen Grove",
    x: 430,
    y: 315,
    radius: 88,
    resources: [{ kind: "wood", amount: 8, maxAmount: 12 }],
    lifecycle: {
      family: "tree",
      stage: "mature",
      species: "ashbark",
      ageYears: 84,
      health: 0.77,
      growth: 0.67,
      decay: 0.15,
    },
  };
}
