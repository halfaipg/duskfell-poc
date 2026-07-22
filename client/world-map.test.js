import assert from "node:assert/strict";
import test from "node:test";

import { worldMapNightAmount, worldMapPoint } from "./world-map.js";

test("world map sun grading is bounded and daylight stays ungraded", () => {
  assert.equal(worldMapNightAmount(1), 0);
  assert.equal(worldMapNightAmount(0.18), 0);
  assert.equal(worldMapNightAmount(-0.6), 1);
  assert.equal(worldMapNightAmount(Number.NaN), 0);
});

test("world map markers align to authoritative world tiles", () => {
  const terrain = { cols: 192, rows: 128 };
  const frame = { x: 10, y: 20, width: 1536, height: 1024 };
  const point = worldMapPoint({ x: 96 * 64, y: 64 * 64 }, terrain, frame);

  assert.deepEqual(point, { x: 778, y: 532 });
});
