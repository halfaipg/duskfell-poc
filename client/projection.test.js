import assert from "node:assert/strict";
import test from "node:test";

import { diamondForTile, projectMap, PROJECTION, screenToMap } from "./projection.js";

test("projection contract names military plan-oblique geometry", () => {
  assert.equal(PROJECTION.kind, "military-plan-oblique");
  assert.equal(PROJECTION.tileW / PROJECTION.tileH, PROJECTION.tileAspectRatio);
  assert.equal(PROJECTION.axisAngleDegrees, 45);
  assert.equal(PROJECTION.heightAxis, "screen-y");

  const eastStep = projectMap(1, 0);
  const westStep = projectMap(0, 1);

  assert.deepEqual(eastStep, { x: 32, y: 32 });
  assert.deepEqual(westStep, { x: -32, y: 32 });
});

test("tile diamond stays 1:1 instead of 2:1 dimetric", () => {
  const diamond = diamondForTile(0, 0);
  const xs = diamond.map((point) => point.x);
  const ys = diamond.map((point) => point.y);

  assert.equal(Math.max(...xs) - Math.min(...xs), 64);
  assert.equal(Math.max(...ys) - Math.min(...ys), 64);
});

test("military projection round-trips map coordinates", () => {
  const origin = { x: 128, y: 48 };
  const projected = projectMap(7.5, 3.25, 0, origin);
  const tile = screenToMap(projected.x, projected.y, origin);

  assert.equal(tile.mapX, 7.5);
  assert.equal(tile.mapY, 3.25);
});

test("height only changes screen y", () => {
  const flat = projectMap(2, 2, 0);
  const raised = projectMap(2, 2, 3);

  assert.equal(flat.x, raised.x);
  assert.equal(flat.y - raised.y, 3 * PROJECTION.zPx);
});
