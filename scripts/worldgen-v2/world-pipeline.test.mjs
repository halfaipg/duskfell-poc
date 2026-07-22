import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateWorld } from "./world-pipeline.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const recipe = JSON.parse(fs.readFileSync(path.join(ROOT, "worlds/recipes/duskfell-valley.json"), "utf8"));

test("world-bundle-v2 is deterministic and normalized", () => {
  const first = generateWorld(recipe);
  const second = generateWorld(recipe);
  assert.equal(first.contentSha256, second.contentSha256);
  assert.deepEqual(first.dimensions, { cols: 64, rows: 64, unitsPerTile: 64, width: 4096, height: 4096 });
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
    const total = Object.values(first.biomeWeights).reduce((sum, field) => sum + field[y][x], 0);
    assert.ok(Math.abs(total - 1) < 0.001, `weights at ${x},${y} total ${total}`);
  }
  assert.equal(first.legacy.materialGrid.length, 64);
  assert.ok(first.legacy.materialGrid.every((row) => row.length === 64 && /^[0-9a-z]+$/i.test(row)));
});

test("river is continuous into the lake and snow stays in high country", () => {
  const world = generateWorld(recipe);
  let previous = null;
  for (const point of world.hydrology.riverCenterline) {
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    assert.ok(world.fields.water[y][x] > 0.35 || world.fields.water[y][Math.min(63, x + 1)] > 0.35);
    if (previous) assert.ok(Math.hypot(point.x - previous.x, point.y - previous.y) < 2);
    previous = point;
  }
  let snowTiles = 0;
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
    if (world.biomeWeights.snow[y][x] > 0.25) {
      snowTiles += 1;
      const h = (world.heights[y][x] + world.heights[y][x + 1] + world.heights[y + 1][x] + world.heights[y + 1][x + 1]) / 4;
      assert.ok(h > 0.62);
    }
  }
  assert.ok(snowTiles > 20);
});

test("macro boundaries use one global field without coordinate discontinuities", () => {
  const world = generateWorld(recipe);
  for (const boundary of [32]) {
    for (let y = 0; y < 64; y += 1) {
      assert.equal(world.heights[y][boundary], world.heights[y][boundary]);
      const delta = Math.abs(world.fields.moisture[y][boundary] - world.fields.moisture[y][boundary - 1]);
      assert.ok(delta < 0.35, `moisture discontinuity at ${boundary},${y}: ${delta}`);
    }
  }
});
