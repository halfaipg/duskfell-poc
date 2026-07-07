import assert from "node:assert/strict";
import test from "node:test";

import {
  directionFromWorldDelta,
  projectedMovementDelta,
  walkAnimationSample,
} from "./player-animation.js";

test("projected movement delta follows military-plan-oblique screen axes", () => {
  assert.deepEqual(projectedMovementDelta(64, 0), { x: 32, y: 32 });
  assert.deepEqual(projectedMovementDelta(0, 64), { x: -32, y: 32 });
  assert.deepEqual(projectedMovementDelta(64, -64), { x: 64, y: 0 });
  assert.deepEqual(projectedMovementDelta(64, 64), { x: 0, y: 64 });
});

test("direction selection preserves plan-axis movement and projected diagonals", () => {
  assert.equal(directionFromWorldDelta(64, 0), "east");
  assert.equal(directionFromWorldDelta(-64, 0), "west");
  assert.equal(directionFromWorldDelta(0, 64), "south");
  assert.equal(directionFromWorldDelta(0, -64), "north");
  assert.equal(directionFromWorldDelta(64, -64), "east");
  assert.equal(directionFromWorldDelta(-64, 64), "west");
  assert.equal(directionFromWorldDelta(64, 64), "south");
  assert.equal(directionFromWorldDelta(-64, -64), "north");
});

test("tiny movement keeps previous facing", () => {
  assert.equal(directionFromWorldDelta(0.001, 0.001, "west"), "west");
});

test("walk animation samples frame progression without lifting the foot anchor", () => {
  const idle = walkAnimationSample({ moving: false, elapsedMs: 900, frameCount: 8, stablePhase: 0.2 });
  assert.deepEqual(idle, {
    frameIndex: 0,
    bodyOffsetX: 0,
    bodyOffsetY: 0,
    cycleRadians: 0,
  });

  const moving = walkAnimationSample({ moving: true, elapsedMs: 270, frameCount: 8, stablePhase: 0 });
  assert.equal(moving.frameIndex, 3);
  assert.equal(moving.bodyOffsetY, 0);
  assert.ok(Math.abs(moving.bodyOffsetX) <= 0.65);
});

test("walk animation cadence responds to speed without changing the foot anchor", () => {
  const slow = walkAnimationSample({ moving: true, elapsedMs: 270, frameCount: 8, speedRatio: 0.62 });
  const normal = walkAnimationSample({ moving: true, elapsedMs: 270, frameCount: 8, speedRatio: 1 });
  const fast = walkAnimationSample({ moving: true, elapsedMs: 270, frameCount: 8, speedRatio: 1.45 });

  assert.ok(slow.frameIndex < normal.frameIndex, "slow movement should advance fewer frames");
  assert.ok(fast.frameIndex > normal.frameIndex, "fast movement should advance more frames");
  assert.equal(slow.bodyOffsetY, 0);
  assert.equal(fast.bodyOffsetY, 0);
  assert.ok(Math.abs(fast.bodyOffsetX) <= 0.65);
});
