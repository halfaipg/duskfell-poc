// Frame-current sun shared by shadow casting, tint overlays and shaders.
// app.js writes it once per frame; render modules read it.
let sun = { elevation: 0.8, direction: { x: -0.45, y: -0.55, z: 0.72 } };

export function setSun(next) {
  if (next) sun = next;
}

export function getSun() {
  return sun;
}

// screen-space direction a shadow falls (opposite the sun), with a length
// factor from elevation: long at the horizon, short at noon, none at night
export function shadowCast() {
  const { direction, elevation } = sun;
  const sx = -(direction.x - direction.y);
  const sy = -(direction.x + direction.y) * 0.5;
  const norm = Math.hypot(sx, sy) || 1;
  const daylight = Math.max(0, Math.min(1, elevation * 2.2));
  const length = daylight <= 0 ? 0 : Math.min(2.1, 0.35 + (1 - Math.max(0.05, elevation)) * 1.5);
  return {
    dirX: sx / norm,
    dirY: Math.max(0.18, sy / norm < 0 ? -sy / norm : sy / norm) , // shadows read best falling down-screen
    length,
    alpha: 0.34 * daylight,
    daylight,
  };
}

// living wind: slow envelope with genuine calm spells, building breezes and
// the odd gust — shared by sprite sway and the GL grass field
export function windStrength(nowMs = performance.now()) {
  const t = nowMs / 1000;
  const weather = Math.sin(t * 0.021 + 1.7) * 0.5 + 0.5;   // ~5 min front
  const gust = Math.sin(t * 0.11) * 0.5 + 0.5;             // ~1 min swells
  const flutter = Math.sin(t * 0.31 + 0.9) * 0.5 + 0.5;
  const strength = weather * 0.7 + gust * 0.5 * weather + flutter * 0.12 - 0.22;
  return Math.max(0, Math.min(1.25, strength * 1.5));
}
