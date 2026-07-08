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
  const interact = distance <= 58;
  const nudge = steeringNudge(state, target.id, distance, dx, dy, interact);
  return {
    up: dy < -8 && !interact,
    down: dy > 8 && !interact,
    left: dx < -8 && !interact,
    right: dx > 8 && !interact,
    ...nudge,
    interact,
  };
}

function steeringNudge(state, targetId, distance, dx, dy, interact) {
  if (interact) return {};
  if (state.targetId !== targetId) {
    state.targetId = targetId;
    state.bestDistance = distance;
    state.stalledFrames = 0;
    state.nudgeFrames = 0;
  } else if (distance < state.bestDistance - 2) {
    state.bestDistance = distance;
    state.stalledFrames = 0;
    state.nudgeFrames = 0;
  } else {
    state.stalledFrames += 1;
  }

  if (state.stalledFrames >= 8 && state.nudgeFrames === 0) {
    state.nudgeFrames = 14;
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
