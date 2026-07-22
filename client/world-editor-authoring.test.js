import assert from "node:assert/strict";
import test from "node:test";

import {
  addAuthoredLandmark,
  addAuthoredSettlement,
  beginAuthoredTrail,
  buildWorldAuthoringPatch,
  commitAuthoredTrail,
  extendAuthoredTrail,
  removeNearestAuthoredFeature,
  validateWorldAuthoringPatch,
} from "./world-editor-authoring.js";
import {
  appendTerrainPoint,
  applyTerrainBrushPoint,
  createTerrainOperation,
} from "./world-editor-terrain-authoring.js";

test("settlement and landmark authoring enforces terrain, spacing, access, and deterministic composition", () => {
  const world = makeWorld();
  const settlement = addAuthoredSettlement(world, 9, 9, { minSpacing: 4 });
  assert.equal(settlement.id, "settlement-03");
  assert.throws(() => addAuthoredSettlement(world, 9, 9, { minSpacing: 4 }), /at least/);
  world.fields.water[8][8] = 1;
  assert.throws(() => addAuthoredSettlement(world, 8, 8), /water/);
  const first = addAuthoredLandmark(world, "ancient-ruin", 3, 8, { minSpacing: 4 });
  const replay = addAuthoredLandmark(makeWorld(), "ancient-ruin", 3, 8, { minSpacing: 4 });
  assert.equal(first.accessFrom, "settlement-01");
  assert.deepEqual(first.composition, replay.composition);
  assert.equal(world.features.landmarks, world.ecology.landmarks);
});

test("trail authoring emits adjacent navigable points and rejects cycles or long bridges", () => {
  const world = makeWorld();
  world.features.trails = [];
  const draft = beginAuthoredTrail(world, 2.5, 2.5);
  extendAuthoredTrail(world, draft, 6.5, 2.5);
  const trail = commitAuthoredTrail(world, draft, 9.5, 2.5);
  assert.equal(trail.from, "settlement-01");
  assert.equal(trail.to, "settlement-02");
  assert.ok(trail.points.every((point, index) => index === 0 || Math.hypot(point.x - trail.points[index - 1].x, point.y - trail.points[index - 1].y) <= Math.SQRT2 + 0.001));
  assert.throws(() => commitAuthoredTrail(world, beginAuthoredTrail(world, 2.5, 2.5), 9.5, 2.5), /cycle/);

  const wet = makeWorld();
  wet.features.trails = [];
  for (let x = 3; x <= 7; x += 1) wet.fields.water[2][x] = 1;
  const rejectedDraft = beginAuthoredTrail(wet, 2.5, 2.5);
  assert.throws(() => commitAuthoredTrail(wet, rejectedDraft, 9.5, 2.5, { maxBridgeTiles: 4 }), /bridge longer/);
  assert.deepEqual(rejectedDraft.points, [{ x: 2.5, y: 2.5 }]);
});

test("authoring patch is source-hash bound and requires a connected settlement tree", () => {
  const source = makeWorld();
  const patch = buildWorldAuthoringPatch(source, structuredClone(source));
  assert.equal(validateWorldAuthoringPatch(patch, source), patch);
  assert.throws(() => validateWorldAuthoringPatch({ ...patch, source: { ...patch.source, bundleContentSha256: "0".repeat(64) } }, source), /source hash/);
  const disconnected = structuredClone(patch);
  disconnected.features.trails.pop();
  assert.throws(() => validateWorldAuthoringPatch(disconnected, source), /connected tree/);
});

test("terrain brush operations are sparse, bounded, and hash-bound with feature edits", () => {
  const source = makeWorld();
  const edited = structuredClone(source);
  const operation = createTerrainOperation("elevation", "raise", 2, 0.2);
  assert.equal(appendTerrainPoint(operation, 6.5, 6.5, source.dimensions), true);
  applyTerrainBrushPoint(edited.heights, operation.points[0], operation);
  const patch = buildWorldAuthoringPatch(source, edited, { terrainOperations: [operation] });

  assert.equal(patch.terrain.schema, "duskfell-terrain-authoring-v1");
  assert.equal(validateWorldAuthoringPatch(patch, source), patch);
  patch.terrain.operations[0].field = "humidity";
  assert.throws(() => validateWorldAuthoringPatch(patch, source), /unsupported field/);
});

test("authoring patch accepts a featureless source world", () => {
  const source = makeWorld();
  delete source.features;
  delete source.ecology;
  const edited = makeWorld();
  const patch = buildWorldAuthoringPatch(source, edited);
  assert.equal(validateWorldAuthoringPatch(patch, source), patch);
});

test("delete tool chooses the nearest feature and updates dependent authority", () => {
  const world = makeWorld();
  addAuthoredSettlement(world, 9.5, 9.5, { minSpacing: 4 });
  world.ecology.landmarks.push(makeLandmark({ x: 3.8, y: 2.5 }));
  world.features.landmarks = world.ecology.landmarks;
  const result = removeNearestAuthoredFeature(world, 2.6, 2.5);
  assert.deepEqual(result, { kind: "settlement", id: "settlement-01" });
  assert.equal(world.features.trails.length, 0);
  assert.equal(world.ecology.landmarks[0].accessFrom, "settlement-02");
  assert.throws(() => removeNearestAuthoredFeature(world, 9.5, 2.5), /retain at least two/);
});

function makeWorld() {
  const cols = 12;
  const rows = 12;
  const grid = (value) => Array.from({ length: rows }, () => Array(cols).fill(value));
  const settlements = [
    { id: "settlement-01", name: "Westwatch", x: 2.5, y: 2.5, suitability: 1 },
    { id: "settlement-02", name: "Eastwatch", x: 9.5, y: 2.5, suitability: 1 },
  ];
  const trail = {
    id: "trail-01",
    from: "settlement-01",
    to: "settlement-02",
    width: 1.15,
    points: Array.from({ length: 8 }, (_, index) => ({ x: index + 2.5, y: 2.5 })),
    bridges: [],
  };
  const landmarks = [makeLandmark()];
  return {
    schema: "duskfell-world-bundle-v2",
    id: "authoring-fixture",
    contentSha256: "a".repeat(64),
    dimensions: { cols, rows, unitsPerTile: 1 },
    heights: Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0.2)),
    fields: { water: grid(0), slope: grid(0), river: grid(0), lake: grid(0) },
    features: { settlements, trails: [trail], landmarks },
    ecology: { landmarks, resourceNodes: [], habitats: { patches: [] } },
  };
}

function makeLandmark(overrides = {}) {
  return {
    id: "landmark-01",
    type: "waystone",
    name: "The Ashen Marker 1",
    x: 4.5,
    y: 4.5,
    suitability: 1,
    accessFrom: "settlement-01",
    distanceTiles: 3,
    composition: { kit: "waystone-composition-v1", stage: "ancient-ruin", ageYears: 1000, resource: "Stone" },
    ...overrides,
  };
}
