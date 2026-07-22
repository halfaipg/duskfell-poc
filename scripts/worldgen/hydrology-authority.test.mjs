import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateWorld } from "../worldgen-v2/world-pipeline.mjs";
import { calculatePriorityFlood, D8 } from "./hydrology-authority.mjs";
import { readRecipe } from "./recipe.mjs";

const RECIPE = new URL("../../worlds/recipes/duskfell-valley.json", import.meta.url);

test("priority flood fills depressions and routes every interior cell to a boundary", () => {
  const width = 5;
  const height = 5;
  const elevation = Float64Array.from([
    0, 0, 0, 0, 0,
    0, 4, 4, 4, 0,
    0, 4, -5, 4, 0,
    0, 4, 4, 4, 0,
    0, 0, 0, 0, 0,
  ]);
  const result = calculatePriorityFlood(elevation, width, height);
  assert.ok(result.fillDepth[2 * width + 2] > 5);
  for (let start = 0; start < width * height; start += 1) {
    let current = start;
    const seen = new Set();
    while (result.directions[current] >= 0) {
      assert.equal(seen.has(current), false, `drainage cycle at ${start}`);
      seen.add(current);
      const x = current % width;
      const y = Math.floor(current / width);
      const [dx, dy] = D8[result.directions[current]];
      current = (y + dy) * width + x + dx;
    }
    const outletX = current % width;
    const outletY = Math.floor(current / width);
    assert.ok(outletX === 0 || outletY === 0 || outletX === width - 1 || outletY === height - 1);
  }
});

test("generated hydrology emits regional watersheds, playable tributaries, lake outlets, and exact shorelines", () => {
  const bundle = generateWorld(readRecipe(fileURLToPath(RECIPE)));
  const authority = bundle.hydrology.authority;
  assert.equal(authority.schema, "duskfell-hydrology-authority-v1");
  assert.ok(authority.watersheds.basins.length >= 4 && authority.watersheds.basins.length <= 40);
  assert.equal(authority.watersheds.basins.reduce((sum, basin) => sum + basin.tiles, 0), bundle.dimensions.cols * bundle.dimensions.rows);
  assert.ok(authority.tributaries.length >= 2);
  for (const tributary of authority.tributaries) {
    assert.ok(tributary.points.length >= 4);
    assert.ok(tributary.points.every((point) => bundle.fields.river[Math.floor(point.y)][Math.floor(point.x)] > 0.08));
  }
  assert.equal(authority.waterBodies.length, 1);
  assert.ok(authority.waterBodies[0].outlet);
  assert.equal(authority.shorelineSegments.length, countShorelineEdges(bundle.fields.water));
});

function countShorelineEdges(water) {
  let count = 0;
  for (let y = 0; y < water.length; y += 1) for (let x = 0; x < water[0].length; x += 1) {
    if (water[y][x] <= 0.45) continue;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) if (!(water[y + dy]?.[x + dx] > 0.45)) count += 1;
  }
  return count;
}
