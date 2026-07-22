export const AUTHORABLE_TERRAIN_FIELDS = new Set(["elevation", "moisture", "rockiness", "riverSpline"]);
const BRUSH_MODES = new Set(["raise", "lower", "smooth"]);
const MAX_OPERATIONS = 256;
const MAX_POINTS_PER_OPERATION = 1024;
const MAX_TOTAL_POINTS = 8192;

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round = (value, places = 3) => Number(value.toFixed(places));

export function createTerrainOperation(field, mode, radius, strength) {
  if (!AUTHORABLE_TERRAIN_FIELDS.has(field)) throw new Error(`${field} is derived and cannot be painted directly`);
  if (field === "riverSpline") return { field, mode: "route", radius: 1, strength: 1, points: [] };
  if (!BRUSH_MODES.has(mode)) throw new Error("terrain brush mode is invalid");
  if (!Number.isFinite(radius) || radius < 1 || radius > 12) throw new Error("terrain brush radius is invalid");
  if (!Number.isFinite(strength) || strength < 0.02 || strength > 0.5) throw new Error("terrain brush strength is invalid");
  return { field, mode, radius: round(radius), strength: round(strength), points: [] };
}

export function appendTerrainPoint(operation, x, y, dimensions) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > dimensions.cols || y > dimensions.rows) throw new Error("terrain brush point is outside the world");
  const point = { x: round(x), y: round(y) };
  const prior = operation.points.at(-1);
  if (prior && Math.hypot(prior.x - point.x, prior.y - point.y) < 0.12) return false;
  if (operation.points.length >= MAX_POINTS_PER_OPERATION) throw new Error(`terrain operation may contain at most ${MAX_POINTS_PER_OPERATION} points`);
  operation.points.push(point);
  return true;
}

export function applyTerrainBrushPoint(grid, point, operation) {
  const rows = grid.length;
  const cols = grid[0].length;
  const copy = operation.mode === "smooth" ? grid.map((row) => [...row]) : null;
  for (let y = Math.max(0, Math.floor(point.y - operation.radius)); y < Math.min(rows, Math.ceil(point.y + operation.radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(point.x - operation.radius)); x < Math.min(cols, Math.ceil(point.x + operation.radius)); x += 1) {
      const falloff = clamp(1 - Math.hypot(x + 0.5 - point.x, y + 0.5 - point.y) / operation.radius);
      if (operation.mode === "smooth") {
        let total = 0;
        let count = 0;
        for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) {
          if (copy[y + oy]?.[x + ox] == null) continue;
          total += copy[y + oy][x + ox];
          count += 1;
        }
        grid[y][x] = clamp(grid[y][x] + ((total / count) - grid[y][x]) * falloff * operation.strength);
      } else {
        grid[y][x] = clamp(grid[y][x] + operation.strength * falloff * (operation.mode === "lower" ? -1 : 1));
      }
    }
  }
}

export function applyRiverRoutePoint(centerline, point, cols) {
  const index = clamp(Math.round(point.y - 0.5), 0, centerline.length - 1);
  centerline[index].x = clamp(point.x, 1, cols - 1);
  for (let offset = 1; offset <= 3; offset += 1) {
    const falloff = 1 - offset / 4;
    for (const neighbor of [index - offset, index + offset]) {
      if (!centerline[neighbor]) continue;
      centerline[neighbor].x += (point.x - centerline[neighbor].x) * falloff * 0.45;
      centerline[neighbor].x = round(clamp(centerline[neighbor].x, 1, cols - 1));
    }
  }
}

export function applyTerrainOperationsToSyntheticInputs({ heights, fields, riverCenterline }, operations, dimensions) {
  validateTerrainOperations(operations, dimensions);
  for (const operation of operations) {
    for (const point of operation.points) {
      if (operation.field === "elevation") applyTerrainBrushPoint(heights, point, operation);
      else if (operation.field === "riverSpline") applyRiverRoutePoint(riverCenterline, point, dimensions.cols);
      else applyTerrainBrushPoint(fields[operation.field], point, operation);
    }
  }
}

export function validateTerrainOperations(operations, dimensions) {
  if (!Array.isArray(operations) || operations.length > MAX_OPERATIONS) throw new Error(`terrain patch may contain at most ${MAX_OPERATIONS} operations`);
  let totalPoints = 0;
  for (const operation of operations) {
    if (!AUTHORABLE_TERRAIN_FIELDS.has(operation?.field)) throw new Error("terrain patch contains an unsupported field");
    if (operation.field === "riverSpline") {
      if (operation.mode !== "route" || operation.radius !== 1 || operation.strength !== 1) throw new Error("river route operation is invalid");
    } else {
      if (!BRUSH_MODES.has(operation.mode)) throw new Error("terrain patch contains an invalid brush mode");
      if (!Number.isFinite(operation.radius) || operation.radius < 1 || operation.radius > 12) throw new Error("terrain patch contains an invalid radius");
      if (!Number.isFinite(operation.strength) || operation.strength < 0.02 || operation.strength > 0.5) throw new Error("terrain patch contains an invalid strength");
    }
    if (!Array.isArray(operation.points) || operation.points.length === 0 || operation.points.length > MAX_POINTS_PER_OPERATION) throw new Error("terrain patch operation points are invalid");
    totalPoints += operation.points.length;
    for (const point of operation.points) {
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || point.x < 0 || point.y < 0 || point.x > dimensions.cols || point.y > dimensions.rows) throw new Error("terrain patch point is outside the world");
    }
  }
  if (totalPoints > MAX_TOTAL_POINTS) throw new Error(`terrain patch may contain at most ${MAX_TOTAL_POINTS} points`);
  return operations;
}
