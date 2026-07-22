import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildTerrain } from "./terrain.js";
import { trailFieldAt } from "./terrain-trails.js";

const trails = [{
  id: "old-road",
  kind: "road",
  widthTiles: 1,
  points: [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }],
}];

test("trail fields follow authored route segments", () => {
  const horizontal = trailFieldAt(5, 2, trails);
  assert.equal(horizontal.pressure, 1);
  assert.ok(horizontal.eastWest > horizontal.northSouth);
  assert.equal(horizontal.trailId, "old-road");

  const vertical = trailFieldAt(8, 5, trails);
  assert.equal(vertical.pressure, 1);
  assert.ok(vertical.northSouth > vertical.eastWest);
});

test("trail fields fade through shoulders and ignore distant ground", () => {
  const shoulder = trailFieldAt(5, 3, trails);
  assert.ok(shoulder.pressure > 0 && shoulder.pressure < 1);
  assert.equal(trailFieldAt(5, 6, trails).pressure, 0);
  assert.equal(trailFieldAt(5, 2, []).pressure, 0);
});

test("authored world trails become road composition in the live terrain bundle", () => {
  const world = JSON.parse(readFileSync("server/data/world.json", "utf8"));
  const bundle = JSON.parse(readFileSync("assets/terrain/world-bundle.json", "utf8"));
  const terrain = buildTerrain(world.map, bundle);

  assert.ok(world.map.terrain.trails.length >= 5);
  for (const route of world.map.terrain.trails) {
    const point = route.points[Math.floor(route.points.length / 2)];
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    const tile = terrain.tiles[y * terrain.cols + x];
    assert.equal(tile.composition.zone, "road", `${route.id} must paint worn ground`);
    assert.ok(tile.biome.pathPressure > 0.9, `${route.id} must own its terrain field`);
  }
});
