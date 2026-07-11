import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAYER_WALK_FRAME_MS,
  directionFromWorldDelta,
  projectedMovementDelta,
  smoothPlayerRenderPosition,
  walkAnimationSample,
} from "./player-animation.js";

test("projected movement delta follows military-plan-oblique screen axes", () => {
  assert.deepEqual(projectedMovementDelta(64, 0), { x: 32, y: 32 });
  assert.deepEqual(projectedMovementDelta(0, 64), { x: -32, y: 32 });
  assert.deepEqual(projectedMovementDelta(64, -64), { x: 64, y: 0 });
  assert.deepEqual(projectedMovementDelta(64, 64), { x: 0, y: 64 });
});

test("direction selection buckets movement into eight world-compass sectors", () => {
  assert.equal(directionFromWorldDelta(64, 0), "east");
  assert.equal(directionFromWorldDelta(-64, 0), "west");
  assert.equal(directionFromWorldDelta(0, 64), "south");
  assert.equal(directionFromWorldDelta(0, -64), "north");
  assert.equal(directionFromWorldDelta(64, -64), "northeast");
  assert.equal(directionFromWorldDelta(-64, 64), "southwest");
  assert.equal(directionFromWorldDelta(64, 64), "southeast");
  assert.equal(directionFromWorldDelta(-64, -64), "northwest");
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
    footfallStrength: 0,
    footfallSide: 0,
  });

  const moving = walkAnimationSample({ moving: true, elapsedMs: PLAYER_WALK_FRAME_MS * 3, frameCount: 8, stablePhase: 0 });
  assert.equal(moving.frameIndex, 3);
  assert.equal(moving.bodyOffsetY, 0);
  assert.ok(Math.abs(moving.bodyOffsetX) <= 0.65);
  assert.ok(moving.footfallStrength >= 0 && moving.footfallStrength <= 1);
  assert.ok([-1, 1].includes(moving.footfallSide));
});

test("walk animation cadence responds to speed without changing the foot anchor", () => {
  const slow = walkAnimationSample({ moving: true, elapsedMs: PLAYER_WALK_FRAME_MS * 3, frameCount: 8, speedRatio: 0.62 });
  const normal = walkAnimationSample({ moving: true, elapsedMs: PLAYER_WALK_FRAME_MS * 3, frameCount: 8, speedRatio: 1 });
  const fast = walkAnimationSample({ moving: true, elapsedMs: PLAYER_WALK_FRAME_MS * 3, frameCount: 8, speedRatio: 1.45 });

  assert.ok(slow.frameIndex < normal.frameIndex, "slow movement should advance fewer frames");
  assert.ok(fast.frameIndex > normal.frameIndex, "fast movement should advance more frames");
  assert.equal(slow.bodyOffsetY, 0);
  assert.equal(fast.bodyOffsetY, 0);
  assert.ok(Math.abs(fast.bodyOffsetX) <= 0.65);
});

test("walk animation can use an authored gait sequence and idle frame", () => {
  const idle = walkAnimationSample({
    moving: false,
    elapsedMs: 0,
    frameCount: 8,
    idleFrame: 3,
    frameSequence: [1, 2, 3, 2],
  });
  const first = walkAnimationSample({
    moving: true,
    elapsedMs: 0,
    frameCount: 8,
    frameSequence: [1, 2, 3, 2],
  });
  const next = walkAnimationSample({
    moving: true,
    elapsedMs: PLAYER_WALK_FRAME_MS,
    frameCount: 8,
    frameSequence: [1, 2, 3, 2],
  });

  assert.equal(idle.frameIndex, 3);
  assert.equal(first.frameIndex, 1);
  assert.equal(next.frameIndex, 2);
});

test("walk animation exposes alternating footfall pulses for terrain feedback", () => {
  const firstPlant = walkAnimationSample({
    moving: true,
    elapsedMs: 0,
    frameCount: 8,
    frameSequence: [1, 2, 3, 4, 5, 6, 7, 6],
  });
  const midStride = walkAnimationSample({
    moving: true,
    elapsedMs: PLAYER_WALK_FRAME_MS * 2,
    frameCount: 8,
    frameSequence: [1, 2, 3, 4, 5, 6, 7, 6],
  });
  const secondPlant = walkAnimationSample({
    moving: true,
    elapsedMs: PLAYER_WALK_FRAME_MS * 4,
    frameCount: 8,
    frameSequence: [1, 2, 3, 4, 5, 6, 7, 6],
  });

  assert.equal(firstPlant.footfallStrength, 1);
  assert.ok(midStride.footfallStrength < 0.05);
  assert.ok(secondPlant.footfallStrength > 0.9);
  assert.notEqual(firstPlant.footfallSide, secondPlant.footfallSide);
});

test("render position smoothing eases between authoritative samples", () => {
  const next = smoothPlayerRenderPosition(
    { x: 100, y: 100 },
    { x: 164, y: 100 },
    16,
    { smoothingMs: 64, snapDistance: 256 },
  );

  assert.ok(next.x > 100);
  assert.ok(next.x < 164);
  assert.equal(next.y, 100);
});

test("render position smoothing snaps large corrections", () => {
  assert.deepEqual(
    smoothPlayerRenderPosition(
      { x: 100, y: 100 },
      { x: 500, y: 500 },
      16,
      { smoothingMs: 64, snapDistance: 128 },
    ),
    { x: 500, y: 500 },
  );
});

test("render position smoothing ignores invalid previous points", () => {
  assert.deepEqual(smoothPlayerRenderPosition(null, { x: 12, y: 18 }, 16), { x: 12, y: 18 });
  assert.deepEqual(smoothPlayerRenderPosition({ x: NaN, y: 0 }, { x: 12, y: 18 }, 16), { x: 12, y: 18 });
});
