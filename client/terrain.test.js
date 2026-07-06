import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTerrain,
  materialForTile,
  projectTerrainTile,
  terrainFacets,
  terrainHeightAtWorld,
} from "./terrain.js";
import { PROJECTION, projectMap } from "./projection.js";

test("builds deterministic military-projection terrain with slopes and transitions", () => {
  const map = testMap();
  const terrain = buildTerrain(map);

  assert.equal(terrain.cols, 24);
  assert.equal(terrain.rows, 16);
  assert.equal(terrain.tiles.length, terrain.cols * terrain.rows);
  assert.ok(terrain.tiles.some((tile) => tile.sloped), "expected at least one sloped tile");
  assert.ok(
    terrain.tiles.some((tile) => tile.transitions.length > 0),
    "expected material transition edges",
  );
  assert.ok(terrain.tiles.some((tile) => tile.decals.length > 0), "expected terrain variation decals");
});

test("water tiles are flat and below surrounding terrain", () => {
  const cols = 24;
  const rows = 16;
  const safeRadiusTiles = 3.5;
  let waterTile = null;

  for (let y = 0; y < rows && !waterTile; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (materialForTile(x, y, cols, rows, safeRadiusTiles) === "water") {
        waterTile = buildTerrain({
          width: cols * PROJECTION.unitsPerTile,
          height: rows * PROJECTION.unitsPerTile,
          safeZoneRadius: safeRadiusTiles * PROJECTION.unitsPerTile,
        }).tiles[y * cols + x];
        break;
      }
    }
  }

  assert.ok(waterTile, "expected deterministic test map to include water");
  assert.deepEqual(waterTile.heights, { nw: -1, ne: -1, se: -1, sw: -1 });
  assert.equal(waterTile.sloped, false);
});

test("terrain height samples stay inside the selected tile corner range", () => {
  const terrain = buildTerrain(testMap());
  const tile = terrain.tiles.find((candidate) => candidate.sloped);
  assert.ok(tile, "expected a sloped tile");

  const worldX = (tile.x + 0.5) * PROJECTION.unitsPerTile;
  const worldY = (tile.y + 0.5) * PROJECTION.unitsPerTile;
  const height = terrainHeightAtWorld(terrain, worldX, worldY);
  const corners = Object.values(tile.heights);

  assert.ok(height >= Math.min(...corners));
  assert.ok(height <= Math.max(...corners));
});

test("terrain seed changes deterministic material placement", () => {
  const first = buildTerrain(testMap());
  const second = buildTerrain({
    ...testMap(),
    terrain: {
      ...testTerrain(),
      seed: 9127,
    },
  });

  assert.notDeepEqual(
    first.tiles.map((tile) => tile.material),
    second.tiles.map((tile) => tile.material),
  );
});

test("projected terrain corners preserve screen x while height changes screen y", () => {
  const tile = {
    x: 2,
    y: 3,
    heights: { nw: 0, ne: 1, se: 2, sw: 1 },
  };
  const origin = { x: 40, y: 70 };
  const projected = projectTerrainTile(tile, origin);
  const flatNe = projectMap(3, 3, 0, origin);

  assert.equal(projected.ne.x, flatNe.x);
  assert.equal(flatNe.y - projected.ne.y, PROJECTION.zPx);
});

test("sloped terrain exposes UO-style split facets for renderer shading", () => {
  const flat = {
    heights: { nw: 1, ne: 1, se: 1, sw: 1 },
    sloped: false,
  };
  assert.deepEqual(terrainFacets(flat), []);

  const sloped = {
    heights: { nw: 0, ne: 1, se: 3, sw: 1 },
    sloped: true,
  };
  const facets = terrainFacets(sloped);

  assert.equal(facets.length, 2);
  assert.deepEqual(facets[0].corners, ["nw", "ne", "se"]);
  assert.deepEqual(facets[1].corners, ["nw", "se", "sw"]);
  for (const facet of facets) {
    assert.ok(facet.shade >= -0.36 && facet.shade <= 0.36);
    assert.ok(facet.alpha >= 0.18 && facet.alpha <= 0.48);
  }
  assert.notEqual(facets[0].shade, facets[1].shade);
});

function testMap() {
  return {
    width: 1536,
    height: 1024,
    safeZoneRadius: 220,
    terrain: testTerrain(),
  };
}

function testTerrain() {
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
