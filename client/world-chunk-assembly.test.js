import assert from "node:assert/strict";
import test from "node:test";

import { buildTerrain, terrainHeightAtWorld, terrainTileAt } from "./terrain.js";
import { createTerrainCache } from "./terrain-cache.js";
import { testTerrain } from "./terrain-test-fixtures.js";
import { assembleWorldChunkWindow } from "./world-chunk-assembly.js";

const BIOMES = ["meadow", "loam", "rock", "snow", "wetland", "water"];

test("chunk window assembly merges exact aprons into a compact regional bundle", () => {
  const fixture = chunkFixture();
  const loaded = new Map([["1,0", fixture.chunks[1]]]);
  const bundle = assembleWorldChunkWindow(fixture.index, loaded);
  assert.deepEqual(bundle.sourceRegion, { offsetX: 1, offsetY: 0, cols: 4, rows: 2 });
  assert.deepEqual(bundle.worldDimensions, fixture.index.dimensions);
  assert.equal(bundle.streamingWindow.chunkIds.join(","), "1-0");
  assert.equal(bundle.fields.vegetation[1][2], fieldValue(3, 1));
  assert.equal(bundle.legacy.heights[0][0], heightValue(1, 0) * 2);
  assert.equal(bundle.legacy.materialGrid[0], "1111");
  assert.equal(bundle.waterAuthority.samplesPerTile, 2);
  assert.deepEqual(bundle.waterAuthority.flowDirectionD8[0], [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(bundle.materialWeights.algorithm, "continuous-terrain-family-blend-v1");
  assert.equal(bundle.materialWeights.weights.meadow[1][2], 0.7);
});

test("chunk window assembly rejects overlap drift and missing authority", () => {
  const fixture = chunkFixture();
  const drifted = structuredClone(fixture.chunks[1]);
  drifted.fields.vegetation[0][0] += 0.1;
  assert.throws(
    () => assembleWorldChunkWindow(fixture.index, new Map([["0,0", fixture.chunks[0]], ["1,0", drifted]])),
    /overlap field vegetation drifts/,
  );
  const incomplete = structuredClone(fixture.chunks[1]);
  delete incomplete.biomeWeights.water;
  assert.throws(() => assembleWorldChunkWindow(fixture.index, new Map([["1,0", incomplete]])), /biome authority is incomplete/);
});

test("assembled windows render at global coordinates and invalidate by chunk identity", () => {
  const fixture = chunkFixture();
  const bundle = assembleWorldChunkWindow(fixture.index, new Map([["1,0", fixture.chunks[1]]]));
  const map = {
    width: fixture.index.dimensions.width,
    height: fixture.index.dimensions.height,
    safeZoneRadius: 64,
    terrain: { ...testTerrain(), maxElevation: 9, detailAuthorityEnabled: false },
  };
  const terrain = buildTerrain(map, bundle);
  assert.equal(terrain.cols, 6);
  assert.equal(terrain.rows, 2);
  assert.deepEqual(terrain.loadedTileOrigin, { x: 1, y: 0 });
  assert.equal(terrain.loadedTiles.length, 8);
  assert.equal(terrainTileAt(terrain, 0, 0), null);
  assert.equal(terrainTileAt(terrain, 1, 0)?.x, 1);
  assert.equal(terrainTileAt(terrain, 4, 1)?.y, 1);
  assert.equal(terrainTileAt(terrain, 5, 0), null);
  assert.ok(Math.abs(terrain.worldData.heightAt(1, 0) - heightValue(1, 0) * 2) < 1e-6);
  assert.equal(terrainHeightAtWorld(terrain, 0.5 * 64, 0.5 * 64), 0);
  assert.ok(Number.isFinite(terrainHeightAtWorld(terrain, 1.5 * 64, 0.5 * 64)));

  const cache = createTerrainCache();
  const first = cache.terrainForMap(map, bundle);
  const firstKey = cache.getTerrainCacheKey();
  const movedBundle = structuredClone(bundle);
  movedBundle.streamingWindow.chunkIds = ["2-0"];
  const second = cache.terrainForMap(map, movedBundle);
  assert.notEqual(cache.getTerrainCacheKey(), firstKey);
  assert.notEqual(second, first);
});

function chunkFixture() {
  const dimensions = { cols: 6, rows: 2, unitsPerTile: 64, width: 384, height: 128 };
  const definitions = [
    { id: "0-0", coord: { x: 0, y: 0 }, core: { x: 0, y: 0, cols: 2, rows: 2 }, sample: { x: 0, y: 0, cols: 3, rows: 2 } },
    { id: "1-0", coord: { x: 1, y: 0 }, core: { x: 2, y: 0, cols: 2, rows: 2 }, sample: { x: 1, y: 0, cols: 4, rows: 2 } },
    { id: "2-0", coord: { x: 2, y: 0 }, core: { x: 4, y: 0, cols: 2, rows: 2 }, sample: { x: 3, y: 0, cols: 3, rows: 2 } },
  ];
  const chunks = definitions.map(chunkFromDefinition);
  return {
    chunks,
    index: {
      world: "assembly-proof",
      sourceBundleContentSha256: "a".repeat(64),
      dimensions,
      chunkTiles: 2,
      apronTiles: 1,
      entries: new Map(definitions.map((entry) => [`${entry.coord.x},${entry.coord.y}`, entry])),
    },
  };
}

function chunkFromDefinition(definition) {
  const { sample } = definition;
  const tileGrid = (fn) => Array.from({ length: sample.rows }, (_, y) => Array.from({ length: sample.cols }, (_, x) => fn(sample.x + x, sample.y + y)));
  const heights = Array.from({ length: sample.rows + 1 }, (_, y) => Array.from({ length: sample.cols + 1 }, (_, x) => heightValue(sample.x + x, sample.y + y)));
  const waterSample = { x: sample.x * 2, y: sample.y * 2, cols: sample.cols * 2, rows: sample.rows * 2 };
  const waterGrid = (fn) => Array.from({ length: waterSample.rows }, (_, y) => Array.from({ length: waterSample.cols }, (_, x) => fn(waterSample.x + x, waterSample.y + y)));
  return {
    schema: "duskfell-world-chunk-v1",
    world: "assembly-proof",
    ...structuredClone(definition),
    unitsPerTile: 64,
    heights,
    fields: { vegetation: tileGrid(fieldValue), water: tileGrid(() => 0) },
    biomeWeights: Object.fromEntries(BIOMES.map((name) => [name, tileGrid(() => name === "meadow" ? 1 : 0)])),
    materialWeights: {
      schema: "duskfell-material-weights-v1",
      algorithm: "continuous-terrain-family-blend-v1",
      normalization: "sum-to-one-per-tile",
      families: ["meadow", "loam"],
      weights: { meadow: tileGrid(() => 0.7), loam: tileGrid(() => 0.3) },
    },
    waterAuthority: {
      schema: "duskfell-water-authority-v1",
      algorithm: "priority-flood-surface-depth-flow-v1",
      samplesPerTile: 2,
      unitsPerTile: 64,
      heightEncoding: "world-elevation-levels-v1",
      heightScale: 2,
      sample: waterSample,
      wetMask: waterGrid(() => 1),
      surfaceHeight: waterGrid((x, y) => fieldValue(x, y)),
      depth: waterGrid(() => 0.04),
      flowDirectionD8: waterGrid(() => 0),
      flowStrength: waterGrid(() => 0.5),
    },
    materialGrid: Array.from({ length: sample.rows }, () => "1".repeat(sample.cols)),
    climateZoneRows: Array.from({ length: sample.rows }, () => "G".repeat(sample.cols)),
    features: { settlements: [], landmarks: [], resourceNodes: [], trailIds: [] },
  };
}

function fieldValue(x, y) {
  return Number((x / 10 + y / 100).toFixed(3));
}

function heightValue(x, y) {
  return Number((x / 20 + y / 200).toFixed(3));
}
