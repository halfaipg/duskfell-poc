export const SMOKE_INTERACT_DISTANCE = 62;
const TARGET_PROGRESS_EPSILON = 1.5;
const STALLED_FRAME_LIMIT = 8;
const NUDGE_FRAME_COUNT = 18;

export function createSteeringState() {
  return {
    targetId: null,
    bestDistance: Infinity,
    stalledFrames: 0,
    nudgeFrames: 0,
    nudgeSign: 1,
  };
}

export function inputTowardTarget(state, me, target) {
  const dx = target.x - me.x;
  const dy = target.y - me.y;
  const distance = Math.hypot(dx, dy);
  const interact = distance <= SMOKE_INTERACT_DISTANCE;
  const nudge = steeringNudge(state, target.id, distance, dx, dy, me, interact);
  return {
    up: dy < -8 && !interact,
    down: dy > 8 && !interact,
    left: dx < -8 && !interact,
    right: dx > 8 && !interact,
    ...nudge,
    interact,
  };
}

function steeringNudge(state, targetId, distance, dx, dy, me, interact) {
  if (interact) return {};
  if (state.targetId !== targetId) {
    state.targetId = targetId;
    state.bestDistance = distance;
    state.stalledFrames = 0;
    state.nudgeFrames = 0;
  } else if (madeProgress(state, distance)) {
    state.bestDistance = distance;
    state.stalledFrames = 0;
    state.nudgeFrames = 0;
  } else {
    state.stalledFrames += 1;
  }

  if (state.stalledFrames >= STALLED_FRAME_LIMIT && state.nudgeFrames === 0) {
    state.nudgeFrames = NUDGE_FRAME_COUNT;
    state.stalledFrames = 0;
    state.nudgeSign *= -1;
  }
  if (state.nudgeFrames <= 0) return {};

  state.nudgeFrames -= 1;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return state.nudgeSign > 0 ? { down: true, up: false } : { up: true, down: false };
  }
  return state.nudgeSign > 0 ? { right: true, left: false } : { left: true, right: false };
}

function madeProgress(state, distance) {
  return distance < state.bestDistance - TARGET_PROGRESS_EPSILON;
}
