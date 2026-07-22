import assert from "node:assert/strict";
import test from "node:test";

import { cliffFaceTextureSample, drawTerrainSideWalls } from "./terrain-draw-surface.js";

test("cliff face sampling stays continuous along a wall run", () => {
  const image = { width: 2048, height: 2048 };
  const first = cliffFaceTextureSample({ x: 3, y: 7 }, { edge: "north", drop: 4 }, image);
  const next = cliffFaceTextureSample({ x: 4, y: 7 }, { edge: "north", drop: 4 }, image);

  assert.equal(next.sourceX - first.sourceX, first.width);
  assert.equal(next.sourceY, first.sourceY);
  assert.equal(first.reverse, false);
  assert.equal(cliffFaceTextureSample({ x: 3, y: 7 }, { edge: "south", drop: 4 }, image).reverse, true);
});

test("cliff texture is mapped onto the diagonal wall basis", () => {
  const transforms = [];
  const drawCalls = [];
  const gradient = { addColorStop() {} };
  const ctx = {
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    clip() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    transform(...args) { transforms.push(args); },
    drawImage(...args) { drawCalls.push(args); },
    createLinearGradient() { return gradient; },
    fill() {},
    stroke() {},
    set fillStyle(_value) {},
    set strokeStyle(_value) {},
    set lineWidth(_value) {},
    set imageSmoothingEnabled(_value) {},
    set globalAlpha(_value) {},
  };
  const tile = {
    x: 2,
    y: 3,
    material: "rock",
    elevationEdges: [{ edge: "east", drop: 4, neighborMaterial: "grass" }],
  };
  const corners = {
    nw: { x: 0, y: 0 },
    ne: { x: 32, y: 32 },
    se: { x: 0, y: 64 },
    sw: { x: -32, y: 32 },
  };

  drawTerrainSideWalls(ctx, tile, corners, { dark: "#252b2a" }, { width: 2048, height: 2048 });

  assert.equal(transforms.length, 1);
  assert.deepEqual(transforms[0].slice(0, 2), [-1 / 3, 1 / 3]);
  assert.equal(transforms[0][2], 0);
  assert.equal(transforms[0][4], 32);
  assert.equal(transforms[0][5], 32);
  assert.equal(drawCalls.length, 1);
});
