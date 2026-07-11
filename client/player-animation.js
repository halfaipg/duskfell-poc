import { PROJECTION } from "./projection.js";

export const PLAYER_MOVEMENT_EPSILON = 0.015;
export const PLAYER_WALK_FRAME_MS = 40;
export const PLAYER_WALK_STOP_GRACE_MS = 145;
export const PLAYER_WALK_SWAY_PX = 0.65;
export const PLAYER_WALK_MIN_SPEED_RATIO = 0.62;
export const PLAYER_WALK_MAX_SPEED_RATIO = 1.45;
export const PLAYER_RENDER_SMOOTHING_MS = 78;
export const PLAYER_RENDER_SNAP_DISTANCE = PROJECTION.unitsPerTile * 2.5;
// idle fidget: after a quiet delay, the fidget clip plays once per period,
// staggered per player so a crowd never fidgets in unison
export const PLAYER_FIDGET_DELAY_MS = 3800;
export const PLAYER_FIDGET_PERIOD_MS = 9200;
export const PLAYER_FIDGET_FRAME_MS = 150;
// breathing: a slow ping-pong of subtle weight-shift frames while standing
export const PLAYER_BREATH_FRAME_MS = 340;
// direction changes crossfade briefly instead of hard-snapping the sprite
export const PLAYER_TURN_FADE_MS = 110;

export function projectedMovementDelta(dx, dy) {
  return {
    x: ((dx - dy) / PROJECTION.unitsPerTile) * PROJECTION.halfW,
    y: ((dx + dy) / PROJECTION.unitsPerTile) * PROJECTION.halfH,
  };
}

// eight world-compass sectors, 45 degrees each: +x is east, +y is south
const DIRECTION_SECTORS = [
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
  "north",
  "northeast",
];

export function directionFromWorldDelta(dx, dy, fallback = "south") {
  if (Math.hypot(dx, dy) <= PLAYER_MOVEMENT_EPSILON) return fallback;
  const angle = Math.atan2(dy, dx);
  const sector = (((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8);
  return DIRECTION_SECTORS[sector];
}

export function walkAnimationSample({
  moving,
  elapsedMs,
  frameCount,
  stablePhase = 0,
  speedRatio = 1,
  idleFrame = 0,
  frameSequence = null,
  idleElapsedMs = null,
  fidgetFrames = null,
  idleFrames = null,
}) {
  const safeFrameCount = Math.max(1, frameCount);
  const idleFrameIndex = clampInteger(idleFrame, 0, safeFrameCount - 1);
  if (!moving) {
    return {
      frameIndex:
        idleFidgetFrame(idleElapsedMs, fidgetFrames, stablePhase, safeFrameCount) ??
        idleBreathingFrame(idleElapsedMs, idleFrames, stablePhase, safeFrameCount) ??
        idleFrameIndex,
      bodyOffsetX: 0,
      bodyOffsetY: 0,
      cycleRadians: 0,
      footfallStrength: 0,
      footfallSide: 0,
    };
  }

  const elapsed = Math.max(0, elapsedMs);
  const sequence = normalizeFrameSequence(frameSequence, safeFrameCount);
  const sequenceLength = sequence.length;
  const speed = clamp(speedRatio, PLAYER_WALK_MIN_SPEED_RATIO, PLAYER_WALK_MAX_SPEED_RATIO);
  const frameMs = PLAYER_WALK_FRAME_MS / speed;
  const phaseFrames = elapsed / frameMs + stablePhase;
  const sequenceIndex = Math.floor(phaseFrames % sequenceLength);
  const frameIndex = sequence[sequenceIndex];
  const cycleRadians = (phaseFrames / sequenceLength) * Math.PI * 2;
  const sway = PLAYER_WALK_SWAY_PX * clamp(0.76 + speed * 0.2, 0.72, 1);
  const footfallWave = Math.cos(cycleRadians * 2);
  const footfallStrength = clamp((footfallWave - 0.72) / 0.28, 0, 1);
  return {
    frameIndex,
    bodyOffsetX: Math.sin(cycleRadians) * sway,
    bodyOffsetY: 0,
    cycleRadians,
    footfallStrength,
    footfallSide: Math.cos(cycleRadians) >= 0 ? 1 : -1,
  };
}

function idleFidgetFrame(idleElapsedMs, fidgetFrames, stablePhase, frameCount) {
  if (!Array.isArray(fidgetFrames) || fidgetFrames.length === 0) return null;
  if (!Number.isFinite(idleElapsedMs) || idleElapsedMs < PLAYER_FIDGET_DELAY_MS) return null;
  const stagger = (stablePhase * 11700) % PLAYER_FIDGET_PERIOD_MS;
  const phase = (idleElapsedMs - PLAYER_FIDGET_DELAY_MS + stagger) % PLAYER_FIDGET_PERIOD_MS;
  const clipMs = fidgetFrames.length * PLAYER_FIDGET_FRAME_MS;
  if (phase >= clipMs) return null;
  const index = Math.min(fidgetFrames.length - 1, Math.floor(phase / PLAYER_FIDGET_FRAME_MS));
  return clampInteger(fidgetFrames[index], 0, frameCount - 1);
}

function idleBreathingFrame(idleElapsedMs, idleFrames, stablePhase, frameCount) {
  if (!Array.isArray(idleFrames) || idleFrames.length === 0) return null;
  if (!Number.isFinite(idleElapsedMs)) return null;
  const phase = Math.floor(idleElapsedMs / PLAYER_BREATH_FRAME_MS + stablePhase * 10);
  return clampInteger(idleFrames[phase % idleFrames.length], 0, frameCount - 1);
}

function normalizeFrameSequence(sequence, frameCount) {
  if (!Array.isArray(sequence) || sequence.length === 0) {
    return Array.from({ length: frameCount }, (_, index) => index);
  }
  const normalized = sequence
    .map((frame) => clampInteger(frame, 0, frameCount - 1))
    .filter((frame, index, frames) => index === 0 || frame !== frames[index - 1]);
  return normalized.length > 0 ? normalized : [0];
}

export function smoothPlayerRenderPosition(previous, target, elapsedMs, options = {}) {
  if (!isFinitePoint(target)) return previous ?? { x: 0, y: 0 };
  if (!isFinitePoint(previous)) return { x: target.x, y: target.y };

  const snapDistance = options.snapDistance ?? PLAYER_RENDER_SNAP_DISTANCE;
  const smoothingMs = options.smoothingMs ?? PLAYER_RENDER_SMOOTHING_MS;
  const dx = target.x - previous.x;
  const dy = target.y - previous.y;
  if (Math.hypot(dx, dy) >= snapDistance || smoothingMs <= 0) {
    return { x: target.x, y: target.y };
  }

  const elapsed = Math.max(0, elapsedMs);
  const alpha = 1 - Math.exp(-elapsed / smoothingMs);
  return {
    x: previous.x + dx * clamp(alpha, 0, 1),
    y: previous.y + dy * clamp(alpha, 0, 1),
  };
}

function isFinitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, Number.isInteger(value) ? value : min));
}
