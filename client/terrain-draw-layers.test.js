import assert from "node:assert/strict";
import test from "node:test";

import {
  cameraWorldBounds,
  TERRAIN_DRAW_OVERSCAN,
  TERRAIN_PRELOAD_OVERSCAN,
} from "./terrain-draw-layers.js";

test("terrain preload bounds extend beyond the painted viewport", () => {
  const camera = { x: 120, y: 80, scale: 2 };
  const visible = cameraWorldBounds(camera, 800, 600, TERRAIN_DRAW_OVERSCAN);
  const preload = cameraWorldBounds(camera, 800, 600, TERRAIN_PRELOAD_OVERSCAN);

  assert.ok(preload.minX < visible.minX);
  assert.ok(preload.maxX > visible.maxX);
  assert.ok(preload.minY < visible.minY);
  assert.ok(preload.maxY > visible.maxY);
  assert.equal(visible.maxX - visible.minX, 800 / 2 + TERRAIN_DRAW_OVERSCAN * 2);
  assert.equal(preload.maxY - preload.minY, 600 / 2 + TERRAIN_PRELOAD_OVERSCAN * 2);
});

test("camera world bounds account for zoom before adding overscan", () => {
  assert.deepEqual(cameraWorldBounds({ x: 10, y: 20, scale: 0.5 }, 500, 300, 100), {
    minX: -90,
    maxX: 1_110,
    minY: -80,
    maxY: 720,
  });
});
