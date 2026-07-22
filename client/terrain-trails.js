export const MAX_TRAILS = 16;
export const MAX_TRAIL_POINTS = 64;

export function trailFieldAt(mapX, mapY, trails) {
  if (!Array.isArray(trails) || trails.length === 0) return emptyTrailField();
  let best = emptyTrailField();
  for (const trail of trails) {
    const points = trail?.points;
    const width = Number(trail?.widthTiles);
    if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(width) || width <= 0) continue;
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      const segment = distanceToSegment(mapX, mapY, start?.x, start?.y, end?.x, end?.y);
      if (!segment) continue;
      const shoulder = width * 1.55;
      const pressure = smoothstep(1 - segment.distance / shoulder);
      if (pressure <= best.pressure) continue;
      const length = Math.hypot(segment.dx, segment.dy) || 1;
      best = {
        pressure,
        northSouth: pressure * Math.abs(segment.dy) / length,
        eastWest: pressure * Math.abs(segment.dx) / length,
        trailId: trail.id ?? null,
        kind: trail.kind ?? "trail",
      };
    }
  }
  return best;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  if (![px, py, ax, ay, bx, by].every(Number.isFinite)) return null;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.000001) return null;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return {
    distance: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)),
    dx,
    dy,
  };
}

function smoothstep(value) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function emptyTrailField() {
  return { pressure: 0, northSouth: 0, eastWest: 0, trailId: null, kind: null };
}
