import assert from "node:assert/strict";
import test from "node:test";

import { CAMERA_VIEW, computeCamera } from "./camera.js";
import { diamondForTile, projectWorld } from "./projection.js";

const map = {
  width: 1800,
  height: 1100,
};

test("camera keeps military tiles square on screen across viewport ratios", () => {
  const viewports = [
    { width: 1280, height: 720 },
    { width: 579, height: 435 },
    { width: 1720, height: 720 },
  ];

  for (const viewport of viewports) {
    const camera = computeCamera({
      viewport,
      map,
      focus: { x: map.width / 2, y: map.height / 2 },
    });
    const screenDiamond = diamondForTile(7, 5, camera.origin).map((point) =>
      cameraToScreen(point, camera),
    );
    const width = extent(screenDiamond, "x");
    const height = extent(screenDiamond, "y");

    assert.ok(Math.abs(width - height) < 0.000001);
  }
});

test("camera uses a bounded uniform zoom instead of stretching the projection", () => {
  const camera = computeCamera({
    viewport: { width: 2400, height: 1600 },
    map,
    focus: { x: map.width / 2, y: map.height / 2 },
  });

  assert.equal(camera.scale, CAMERA_VIEW.maxScale);
  assert.equal(camera.visibleWorld.width, 2400 / CAMERA_VIEW.maxScale);
  assert.equal(camera.visibleWorld.height, 1600 / CAMERA_VIEW.maxScale);
});

test("camera keeps edge focus inside the projected world margins", () => {
  const camera = computeCamera({
    viewport: { width: 980, height: 620 },
    map,
    focus: { x: 0, y: 0 },
  });
  const focusScreen = projectWorld(0, 0, 0, camera.origin);

  assert.ok(focusScreen.x >= camera.x);
  assert.ok(focusScreen.y >= camera.y);
  assert.ok(focusScreen.x <= camera.x + camera.visibleWorld.width);
  assert.ok(focusScreen.y <= camera.y + camera.visibleWorld.height);
});

test("camera falls back to map center when no player focus exists", () => {
  const camera = computeCamera({
    viewport: { width: 980, height: 620 },
    map,
    focus: null,
  });
  const center = projectWorld(map.width / 2, map.height / 2, 0, camera.origin);

  assert.ok(center.x >= camera.x);
  assert.ok(center.y >= camera.y);
  assert.ok(center.x <= camera.x + camera.visibleWorld.width);
  assert.ok(center.y <= camera.y + camera.visibleWorld.height);
});

function cameraToScreen(point, camera) {
  return {
    x: (point.x - camera.x) * camera.scale,
    y: (point.y - camera.y) * camera.scale,
  };
}

function extent(points, axis) {
  const values = points.map((point) => point[axis]);
  return Math.max(...values) - Math.min(...values);
}
