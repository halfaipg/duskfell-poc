import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildTerrain, terrainHeightAtWorld } from "./terrain.js";
import { testTerrain } from "./terrain-test-fixtures.js";

const bundle = JSON.parse(fs.readFileSync(new URL("../assets/terrain/worlds/valley-v2/world-bundle-v2.json", import.meta.url)));
const map = {
  width: 4096,
  height: 4096,
  safeZoneRadius: 256,
  terrain: { ...testTerrain(), seed: 74291, maxElevation: 9 },
};

test("valley-v2 runtime consumes authority dimensions and continuous weights", () => {
  const terrain = buildTerrain(map, bundle);
  assert.equal(terrain.cols, 64);
  assert.equal(terrain.rows, 64);
  assert.equal(terrain.width, 4096);
  const lake = terrain.tiles[43 * 64 + 34];
  assert.equal(lake.material, "water");
  const weights = terrain.worldData.weightsAt(20.5, 20.5);
  assert.ok(weights.fen + weights.meadow + weights.heath + weights.chalk + weights.frost > 0.99);
  assert.ok(terrain.tiles.some((tile) => tile.biome.snow > 0.2));
});

test("valley-v2 is placed around the existing server world center", () => {
  const serverMap = { ...map, width: 12288, height: 8192 };
  const terrain = buildTerrain(serverMap, bundle);
  assert.equal(terrain.cols, 192);
  assert.equal(terrain.rows, 128);
  assert.equal(terrain.tiles[75 * 192 + 98].material, "water");
  assert.ok(terrain.tiles[64 * 192 + 96]);
});

test("valley-v2 actor grounding follows its continuous painted height field", () => {
  const terrain = buildTerrain(
    {
      ...map,
      terrain: { ...map.terrain, detailAuthorityEnabled: false },
    },
    bundle,
  );
  const units = terrain.profile.unitsPerTile;
  const epsilon = 0.001;

  for (let y = 0; y < terrain.rows; y += 1) {
    for (let x = 0; x < terrain.cols - 1; x += 1) {
      const left = terrain.tiles[y * terrain.cols + x];
      const right = terrain.tiles[y * terrain.cols + x + 1];
      if (left.material === "water" || right.material === "water") continue;
      const before = terrainHeightAtWorld(terrain, (x + 1) * units - epsilon, (y + 0.5) * units);
      const after = terrainHeightAtWorld(terrain, (x + 1) * units + epsilon, (y + 0.5) * units);
      assert.ok(Math.abs(before - after) < 0.001, `unexpected grounding step across x=${x + 1}, y=${y}`);
    }
  }

  const fractionalTile = terrain.tiles.find((tile) => {
    if (tile.material === "water") return false;
    const sampled = terrain.worldData.heightAt(tile.x + 0.5, tile.y + 0.5);
    return Math.abs(sampled - tile.height.average) > 0.2;
  });
  assert.ok(fractionalTile, "expected a tile where painted and rounded legacy heights differ");
  const mapX = fractionalTile.x + 0.5;
  const mapY = fractionalTile.y + 0.5;
  assert.equal(
    terrainHeightAtWorld(terrain, mapX * units, mapY * units),
    terrain.worldData.heightAt(mapX, mapY),
  );
  assert.deepEqual(terrain.interiorSpaces, []);
});
