import assert from "node:assert/strict";
import test from "node:test";

import { parseServerMessage } from "./server-messages.js";
import {
  PLAYER_ID,
  RECEIPT_ID,
  validGroveObject,
  validSnapshot,
  validTerrain,
} from "./server-message-test-fixtures.js";

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
