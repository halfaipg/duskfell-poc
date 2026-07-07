import { PROJECTION } from "./projection.js";

export const PLAYER_MOVEMENT_EPSILON = 0.015;
export const PLAYER_WALK_FRAME_MS = 90;
export const PLAYER_WALK_STOP_GRACE_MS = 145;
export const PLAYER_WALK_SWAY_PX = 0.65;
export const PLAYER_WALK_MIN_SPEED_RATIO = 0.62;
export const PLAYER_WALK_MAX_SPEED_RATIO = 1.45;

export function projectedMovementDelta(dx, dy) {
  return {
    x: ((dx - dy) / PROJECTION.unitsPerTile) * PROJECTION.halfW,
    y: ((dx + dy) / PROJECTION.unitsPerTile) * PROJECTION.halfH,
  };
}

export function directionFromWorldDelta(dx, dy, fallback = "south") {
  if (Math.hypot(dx, dy) <= PLAYER_MOVEMENT_EPSILON) return fallback;

  const screen = projectedMovementDelta(dx, dy);
  const absScreenX = Math.abs(screen.x);
  const absScreenY = Math.abs(screen.y);
  if (Math.abs(absScreenX - absScreenY) <= 0.000001) {
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
    if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? "south" : "north";
    if (Math.sign(dx) !== Math.sign(dy)) return screen.x > 0 ? "east" : "west";
    return screen.y > 0 ? "south" : "north";
  }
  if (absScreenX > absScreenY) return screen.x > 0 ? "east" : "west";
  return screen.y > 0 ? "south" : "north";
}

export function walkAnimationSample({ moving, elapsedMs, frameCount, stablePhase = 0, speedRatio = 1 }) {
  const safeFrameCount = Math.max(1, frameCount);
  if (!moving) {
    return {
      frameIndex: 0,
      bodyOffsetX: 0,
      bodyOffsetY: 0,
      cycleRadians: 0,
    };
  }

  const elapsed = Math.max(0, elapsedMs);
  const speed = clamp(speedRatio, PLAYER_WALK_MIN_SPEED_RATIO, PLAYER_WALK_MAX_SPEED_RATIO);
  const frameMs = PLAYER_WALK_FRAME_MS / speed;
  const frameIndex = Math.floor((elapsed / frameMs + stablePhase) % safeFrameCount);
  const cycleRadians = (elapsed / (frameMs * safeFrameCount)) * Math.PI * 2;
  const sway = PLAYER_WALK_SWAY_PX * clamp(0.76 + speed * 0.2, 0.72, 1);
  return {
    frameIndex,
    bodyOffsetX: Math.sin(cycleRadians) * sway,
    bodyOffsetY: 0,
    cycleRadians,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
