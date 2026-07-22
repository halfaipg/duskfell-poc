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

test("preserves the server-authoritative terrain detail layer switch", () => {
  const snapshot = validSnapshot();
  snapshot.map.terrain.detailAuthorityEnabled = false;

  const message = parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot }));
  assert.equal(message.map.terrain.detailAuthorityEnabled, false);

  snapshot.map.terrain.detailAuthorityEnabled = "false";
  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /detailAuthorityEnabled must be a boolean/,
  );
});

test("preserves the independent scenic terrain detail switch", () => {
  const snapshot = validSnapshot();
  snapshot.map.terrain.visualDetailEnabled = false;

  const message = parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot }));
  assert.equal(message.map.terrain.visualDetailEnabled, false);

  delete snapshot.map.terrain.visualDetailEnabled;
  const legacy = parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot }));
  assert.equal(legacy.map.terrain.visualDetailEnabled, true);

  snapshot.map.terrain.visualDetailEnabled = "false";
  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /visualDetailEnabled must be a boolean/,
  );
});

test("normalizes fixed-point terrain height precision", () => {
  const snapshot = validSnapshot();
  snapshot.map.terrain.vertexHeightPrecision = 1000;
  const message = parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot }));
  assert.equal(message.map.terrain.vertexHeightPrecision, 1000);

  delete snapshot.map.terrain.vertexHeightPrecision;
  const legacy = parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot }));
  assert.equal(legacy.map.terrain.vertexHeightPrecision, 1);

  snapshot.map.terrain.vertexHeightPrecision = 0;
  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /vertexHeightPrecision/,
  );
});

test("normalizes hash-bound regional routing provenance", () => {
  const snapshot = validSnapshot();
  snapshot.map.region = {
    schemaVersion: "duskfell-region-routing-v1",
    atlasId: "duskfell-continent",
    atlasContentSha256: "a".repeat(64),
    regionId: "duskfell-continent-r2-3",
    coord: { x: 2, y: 3 },
    tileOrigin: { x: 50, y: 57 },
    neighbors: {
      north: "duskfell-continent-r2-2",
      east: "duskfell-continent-r3-3",
      south: "duskfell-continent-r2-4",
      west: "duskfell-continent-r1-3",
    },
  };
  const message = parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot }));
  assert.equal(message.map.region.regionId, "duskfell-continent-r2-3");
  assert.deepEqual(message.map.region.tileOrigin, { x: 50, y: 57 });

  snapshot.map.region.tileOrigin.x = 51;
  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /tileOrigin does not match regional grid/,
  );
});

test("accepts bounded trails and rejects malformed trail routes", () => {
  const snapshot = validSnapshot();
  snapshot.map.terrain.trails = [{
    id: "old-road",
    label: "Old Road",
    kind: "road",
    widthTiles: 1.2,
    points: [{ x: 2.5, y: 3.5 }, { x: 8.5, y: 9.5 }],
  }];
  const message = parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot }));
  assert.equal(message.map.terrain.trails[0].id, "old-road");

  snapshot.map.terrain.trails[0].points[1].x = 99;
  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /must be inside terrain bounds/,
  );

  snapshot.map.terrain = validTerrain();
  snapshot.map.terrain.trails = [{
    id: "Bad Trail",
    label: "Bad Trail",
    kind: "path",
    widthTiles: 1,
    points: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
  }];
  assert.throws(
    () => parseServerMessage(JSON.stringify({ type: "snapshot", ...snapshot })),
    /lowercase kebab-case/,
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
