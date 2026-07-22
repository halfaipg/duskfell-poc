import { validateTerrainOperations } from "./world-editor-terrain-authoring.js";

const LANDMARK_TYPES = new Set(["ancient-ruin", "sacred-grove", "mineral-scar", "waystone"]);
const MAX_SETTLEMENTS = 8;
const MAX_TRAILS = 7;
const MAX_TRAIL_POINTS = 64;
const MAX_LANDMARKS = 4;

export function addAuthoredSettlement(world, x, y, options = {}) {
  const point = snapPoint(world, x, y);
  assertWalkable(world, point, options.maxSlope ?? 0.72, "settlement");
  const settlements = world.features?.settlements;
  if (!Array.isArray(settlements) || settlements.length >= MAX_SETTLEMENTS) throw new Error("settlement limit reached");
  const minimumSpacing = options.minSpacing ?? 8;
  if (settlements.some((settlement) => distance(settlement, point) < minimumSpacing)) throw new Error(`settlement must be at least ${minimumSpacing} tiles from another settlement`);
  const id = nextId(settlements, "settlement", 2);
  const settlement = { id, name: `Frontier Hold ${settlements.length + 1}`, ...point, suitability: 1 };
  settlements.push(settlement);
  return settlement;
}

export function beginAuthoredTrail(world, x, y, options = {}) {
  const settlement = nearestSettlement(world, x, y, options.snapRadius ?? 2.5);
  if (!settlement) throw new Error("start a trail on an existing settlement");
  return { from: settlement.id, points: [{ x: settlement.x, y: settlement.y }] };
}

export function extendAuthoredTrail(world, draft, x, y) {
  if (!draft?.from || !Array.isArray(draft.points) || draft.points.length === 0) throw new Error("trail draft is invalid");
  const target = snapPoint(world, x, y);
  const segment = rasterSegment(draft.points.at(-1), target);
  for (const point of segment.slice(1)) {
    if (samePoint(point, draft.points.at(-1))) continue;
    draft.points.push(point);
    if (draft.points.length > MAX_TRAIL_POINTS) throw new Error(`trail may contain at most ${MAX_TRAIL_POINTS} points`);
  }
  return draft;
}

export function commitAuthoredTrail(world, draft, x, y, options = {}) {
  const endpoint = nearestSettlement(world, x, y, options.snapRadius ?? 2.5);
  if (!endpoint || endpoint.id === draft.from) throw new Error("finish the trail on a different settlement");
  const candidate = { from: draft.from, points: draft.points.map(copyPoint) };
  extendAuthoredTrail(world, candidate, endpoint.x, endpoint.y);
  const trails = world.features?.trails;
  if (!Array.isArray(trails) || trails.length >= MAX_TRAILS) throw new Error("trail limit reached");
  if (settlementsConnected(world.features.settlements, trails, draft.from, endpoint.id)) throw new Error("trail would create a cycle in the settlement network");
  candidate.points[candidate.points.length - 1] = { x: endpoint.x, y: endpoint.y };
  validateTrailPoints(world, candidate.points, options.maxSlope ?? 0.72, options.maxBridgeTiles ?? 4);
  const bridges = candidate.points.filter((point) => sample(world.fields.water, point) > 0.3);
  const id = nextId(trails, "trail", 2);
  const trail = { id, from: draft.from, to: endpoint.id, width: options.width ?? 1.15, points: candidate.points.map(copyPoint), bridges: bridges.map(copyPoint) };
  trails.push(trail);
  return trail;
}

export function addAuthoredLandmark(world, type, x, y, options = {}) {
  if (!LANDMARK_TYPES.has(type)) throw new Error("landmark type is unsupported");
  const point = snapPoint(world, x, y);
  assertWalkable(world, point, options.maxSlope ?? 0.72, "landmark");
  const settlements = world.features?.settlements ?? [];
  if (settlements.length === 0) throw new Error("landmark requires an access settlement");
  const landmarks = world.ecology?.landmarks;
  if (!Array.isArray(landmarks) || landmarks.length >= MAX_LANDMARKS) throw new Error("landmark limit reached");
  const minimumSpacing = options.minSpacing ?? 8;
  if (landmarks.some((landmark) => distance(landmark, point) < minimumSpacing)) throw new Error(`landmark must be at least ${minimumSpacing} tiles from another landmark`);
  const access = [...settlements].sort((left, right) => distance(left, point) - distance(right, point) || left.id.localeCompare(right.id))[0];
  const index = nextNumericId(landmarks, "landmark") + 1;
  const landmark = {
    id: `landmark-${String(index).padStart(2, "0")}`,
    type,
    name: landmarkName(type, index),
    ...point,
    suitability: 1,
    accessFrom: access.id,
    distanceTiles: round(distance(access, point)),
    composition: landmarkComposition(type, world.seed ?? world.generation?.seed ?? 0, point),
  };
  landmarks.push(landmark);
  world.features.landmarks = landmarks;
  return landmark;
}

export function removeNearestAuthoredFeature(world, x, y, radius = 2.5) {
  const point = { x, y };
  const landmarks = world.ecology?.landmarks ?? [];
  const settlements = world.features?.settlements ?? [];
  const trails = world.features?.trails ?? [];
  const candidates = [
    ...landmarks.map((item) => ({ kind: "landmark", item, distance: distance(item, point) })),
    ...settlements.map((item) => ({ kind: "settlement", item, distance: distance(item, point) })),
    ...trails.map((item) => ({
      kind: "trail",
      item,
      distance: Math.min(...item.points.map((trailPoint) => distance(trailPoint, point))),
    })),
  ].filter((candidate) => candidate.distance <= radius)
    .sort((left, right) => left.distance - right.distance || left.kind.localeCompare(right.kind) || left.item.id.localeCompare(right.item.id));
  const selected = candidates[0];
  if (!selected) return null;
  if (selected.kind === "landmark") {
    removeById(landmarks, selected.item.id);
    world.features.landmarks = landmarks;
    return { kind: "landmark", id: selected.item.id };
  }
  if (selected.kind === "settlement") {
    if (settlements.length === 2) throw new Error("a world must retain at least two settlements");
    removeById(settlements, selected.item.id);
    world.features.trails = trails.filter((trail) => trail.from !== selected.item.id && trail.to !== selected.item.id);
    for (const item of landmarks) {
      if (item.accessFrom !== selected.item.id) continue;
      const access = [...settlements].sort((left, right) => distance(left, item) - distance(right, item))[0];
      if (access) {
        item.accessFrom = access.id;
        item.distanceTiles = round(distance(access, item));
      }
    }
    return { kind: "settlement", id: selected.item.id };
  }
  removeById(trails, selected.item.id);
  return { kind: "trail", id: selected.item.id };
}

export function buildWorldAuthoringPatch(sourceWorld, editedWorld, options = {}) {
  if (!sourceWorld?.contentSha256 || sourceWorld.id !== editedWorld?.id) throw new Error("authoring patch requires a matching hashed source world");
  const patch = {
    schema: "duskfell-world-authoring-patch-v1",
    source: {
      world: sourceWorld.id,
      bundleContentSha256: sourceWorld.contentSha256,
      dimensions: { cols: sourceWorld.dimensions.cols, rows: sourceWorld.dimensions.rows, unitsPerTile: sourceWorld.dimensions.unitsPerTile },
    },
    features: {
      settlements: structuredClone(editedWorld.features?.settlements ?? []),
      trails: structuredClone(editedWorld.features?.trails ?? []),
      landmarks: structuredClone(editedWorld.ecology?.landmarks ?? []),
    },
  };
  if ((options.terrainOperations?.length ?? 0) > 0) {
    patch.terrain = {
      schema: "duskfell-terrain-authoring-v1",
      operations: structuredClone(options.terrainOperations),
    };
  }
  validateWorldAuthoringPatch(patch, sourceWorld, options);
  return patch;
}

export function validateWorldAuthoringPatch(patch, sourceWorld, options = {}) {
  const failures = [];
  check(patch?.schema === "duskfell-world-authoring-patch-v1", "authoring patch schema is invalid", failures);
  check(patch?.source?.world === sourceWorld?.id, "authoring patch source world is invalid", failures);
  check(patch?.source?.bundleContentSha256 === sourceWorld?.contentSha256, "authoring patch source hash does not match", failures);
  check(JSON.stringify(patch?.source?.dimensions) === JSON.stringify(sourceWorld?.dimensions && {
    cols: sourceWorld.dimensions.cols,
    rows: sourceWorld.dimensions.rows,
    unitsPerTile: sourceWorld.dimensions.unitsPerTile,
  }), "authoring patch dimensions do not match", failures);
  if (patch.terrain != null) {
    check(patch.terrain?.schema === "duskfell-terrain-authoring-v1", "terrain authoring schema is invalid", failures);
    try {
      validateTerrainOperations(patch.terrain?.operations, patch.source.dimensions);
    } catch (error) {
      failures.push(error.message);
    }
  }
  const features = patch?.features;
  check(Array.isArray(features?.settlements) && features.settlements.length >= 2 && features.settlements.length <= MAX_SETTLEMENTS, "authoring settlements are invalid", failures);
  check(Array.isArray(features?.trails) && features.trails.length <= MAX_TRAILS, "authoring trails are invalid", failures);
  check(Array.isArray(features?.landmarks) && features.landmarks.length >= 1 && features.landmarks.length <= MAX_LANDMARKS, "authoring landmarks are invalid", failures);
  if (failures.length) throw new Error(failures.join("; "));
  const settlementIds = new Set();
  for (const settlement of features.settlements) {
    if (typeof settlement.id !== "string" || settlementIds.has(settlement.id)) throw new Error("authoring settlement id is missing or duplicated");
    settlementIds.add(settlement.id);
    assertWalkable(sourceWorld, settlement, options.maxSlope ?? 0.72, `settlement ${settlement.id}`);
  }
  const trailIds = new Set();
  for (const trail of features.trails) {
    if (typeof trail.id !== "string" || trailIds.has(trail.id)) throw new Error("authoring trail id is missing or duplicated");
    trailIds.add(trail.id);
    if (!settlementIds.has(trail.from) || !settlementIds.has(trail.to) || trail.from === trail.to) throw new Error(`authoring trail ${trail.id} endpoints are invalid`);
    validateTrailPoints(sourceWorld, trail.points, options.maxSlope ?? 0.72, options.maxBridgeTiles ?? 4);
    const expectedBridges = trail.points.filter((point) => sample(sourceWorld.fields.water, point) > 0.3);
    if (JSON.stringify(expectedBridges) !== JSON.stringify(trail.bridges)) throw new Error(`authoring trail ${trail.id} bridge authority is invalid`);
  }
  if (features.trails.length !== Math.max(0, features.settlements.length - 1) || !allSettlementsConnected(features.settlements, features.trails)) {
    throw new Error("authoring trail network must be a connected tree");
  }
  const landmarkIds = new Set();
  for (const landmark of features.landmarks) {
    if (typeof landmark.id !== "string" || landmarkIds.has(landmark.id) || !LANDMARK_TYPES.has(landmark.type)) throw new Error("authoring landmark id or type is invalid");
    landmarkIds.add(landmark.id);
    if (!settlementIds.has(landmark.accessFrom)) throw new Error(`authoring landmark ${landmark.id} access settlement is invalid`);
    assertWalkable(sourceWorld, landmark, options.maxSlope ?? 0.72, `landmark ${landmark.id}`);
  }
  return patch;
}

function validateTrailPoints(world, points, maxSlope, maxBridgeTiles) {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_TRAIL_POINTS) throw new Error(`trail must contain 2-${MAX_TRAIL_POINTS} points`);
  let bridgeRun = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!inside(world, point)) throw new Error("trail leaves world bounds");
    if (sample(world.fields.slope, point) > maxSlope) throw new Error("trail crosses terrain above the slope limit");
    if (index > 0 && distance(points[index - 1], point) > Math.SQRT2 + 0.001) throw new Error("trail points are not adjacent");
    bridgeRun = sample(world.fields.water, point) > 0.3 ? bridgeRun + 1 : 0;
    if (bridgeRun > maxBridgeTiles) throw new Error(`trail requires a bridge longer than ${maxBridgeTiles} tiles`);
  }
}

function settlementsConnected(settlements, trails, from, to) {
  const adjacency = new Map(settlements.map((settlement) => [settlement.id, []]));
  for (const trail of trails) {
    adjacency.get(trail.from)?.push(trail.to);
    adjacency.get(trail.to)?.push(trail.from);
  }
  const queue = [from];
  const seen = new Set(queue);
  for (let index = 0; index < queue.length; index += 1) {
    if (queue[index] === to) return true;
    for (const next of adjacency.get(queue[index]) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return false;
}

function allSettlementsConnected(settlements, trails) {
  if (settlements.length === 0) return false;
  const reachable = new Set([settlements[0].id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const trail of trails) {
      if (reachable.has(trail.from) && !reachable.has(trail.to)) { reachable.add(trail.to); changed = true; }
      if (reachable.has(trail.to) && !reachable.has(trail.from)) { reachable.add(trail.from); changed = true; }
    }
  }
  return reachable.size === settlements.length;
}

function assertWalkable(world, point, maxSlope, label) {
  if (!inside(world, point)) throw new Error(`${label} is outside world bounds`);
  if (sample(world.fields.water, point) > 0.25) throw new Error(`${label} cannot be placed in water`);
  if (sample(world.fields.slope, point) > maxSlope) throw new Error(`${label} exceeds the slope limit`);
}

function rasterSegment(from, to) {
  let x = Math.floor(from.x);
  let y = Math.floor(from.y);
  const targetX = Math.floor(to.x);
  const targetY = Math.floor(to.y);
  const dx = Math.abs(targetX - x);
  const dy = Math.abs(targetY - y);
  const sx = x < targetX ? 1 : -1;
  const sy = y < targetY ? 1 : -1;
  let error = dx - dy;
  const points = [{ x: x + 0.5, y: y + 0.5 }];
  while (x !== targetX || y !== targetY) {
    const twice = error * 2;
    if (twice > -dy) { error -= dy; x += sx; }
    if (twice < dx) { error += dx; y += sy; }
    points.push({ x: x + 0.5, y: y + 0.5 });
  }
  return points;
}

function landmarkComposition(type, seed, point) {
  const age = 1000 + Math.floor(hash01(point.x, point.y, seed) * 199000);
  if (type === "ancient-ruin") return { kit: "ruin-composition-v1", stage: "sunken-foundation", ageYears: age, resource: "Stone" };
  if (type === "sacred-grove") return { kit: "grove-composition-v1", stage: "ancient", ageYears: 240 + Math.floor(age / 1000), resource: "Wood" };
  if (type === "mineral-scar") return { kit: "outcrop-composition-v1", stage: "mineral", ageYears: age, resource: "Ore" };
  return { kit: "waystone-composition-v1", stage: "ancient-ruin", ageYears: age, resource: "Stone" };
}

function landmarkName(type, index) {
  return ({ "ancient-ruin": "The Fallen Court", "sacred-grove": "The Elder Bower", "mineral-scar": "Ironwake Scar", waystone: "The Ashen Marker" })[type] + ` ${index}`;
}

function snapPoint(world, x, y) {
  return {
    x: clamp(Math.floor(x) + 0.5, 0.5, world.dimensions.cols - 0.5),
    y: clamp(Math.floor(y) + 0.5, 0.5, world.dimensions.rows - 0.5),
  };
}

function nearestSettlement(world, x, y, radius) {
  return nearest(world.features?.settlements ?? [], { x, y }, radius);
}

function nearest(items, point, radius) {
  return items.map((item) => ({ item, distance: distance(item, point) }))
    .filter((entry) => entry.distance <= radius)
    .sort((left, right) => left.distance - right.distance || left.item.id.localeCompare(right.item.id))[0]?.item ?? null;
}

function sample(grid, point) {
  return grid[Math.floor(point.y)]?.[Math.floor(point.x)] ?? Infinity;
}

function inside(world, point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y) && point.x >= 0 && point.y >= 0 && point.x < world.dimensions.cols && point.y < world.dimensions.rows;
}

function nextId(items, prefix, digits) {
  return `${prefix}-${String(nextNumericId(items, prefix) + 1).padStart(digits, "0")}`;
}

function nextNumericId(items, prefix) {
  return items.reduce((highest, item) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(item.id ?? "");
    return Math.max(highest, match ? Number(match[1]) : 0);
  }, 0);
}

function removeById(items, id) {
  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) items.splice(index, 1);
}

function copyPoint(point) { return { x: point.x, y: point.y }; }
function samePoint(left, right) { return left.x === right.x && left.y === right.y; }
function distance(left, right) { return Math.hypot(left.x - right.x, left.y - right.y); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, digits = 5) { return Number(value.toFixed(digits)); }
function check(condition, message, failures) { if (!condition) failures.push(message); }

function hash01(x, y, seed) {
  let value = Math.imul(Math.floor(x * 2) + 0x9e3779b9, 374761393) ^ Math.imul(Math.floor(y * 2) + seed, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}
