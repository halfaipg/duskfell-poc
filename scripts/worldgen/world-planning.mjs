import crypto from "node:crypto";
import { waterAtTile } from "./water-authority.mjs";
import { attachMaterialWeights } from "./material-weights.mjs";

const D8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const MATERIAL_DIRT = "2";
const MATERIAL_COBBLE = "6";

export function planWorldFeatures(input, recipe) {
  const bundle = structuredClone(input);
  const { cols, rows } = bundle.dimensions;
  const canonicalWater = field(rows, cols, 0);
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) canonicalWater[y][x] = authoritativeWater(bundle, x, y);
  const waterDistance = distanceFromWater(canonicalWater, cols, rows);
  const components = traversableComponents(bundle.fields.slope, recipe.planning.maxTrailSlope, cols, rows);
  const candidates = [];
  for (let y = 2; y < rows - 2; y += 1) {
    for (let x = 2; x < cols - 2; x += 1) {
      const water = canonicalWater[y][x];
      const slope = bundle.fields.slope[y][x];
      if (water > 0.25 || slope > recipe.planning.maxTrailSlope) continue;
      const access = 1 - Math.min(1, Math.abs(waterDistance[y][x] - 4) / 8);
      const score =
        bundle.fields.soil[y][x] * 0.28 +
        (1 - bundle.fields.rockiness[y][x]) * 0.2 +
        (1 - bundle.fields.snow[y][x]) * 0.12 +
        bundle.fields.vegetation[y][x] * 0.1 +
        access * 0.27 +
        hash01(x, y, recipe.seed) * 0.03;
      candidates.push({ x, y, score, component: components[y][x] });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  const candidatesByComponent = Map.groupBy(candidates, (candidate) => candidate.component);
  const selections = [...candidatesByComponent.values()]
    .map((group) => selectSettlements(group, recipe.planning.settlements, recipe.planning.minSettlementSpacing))
    .filter((group) => group.length === recipe.planning.settlements)
    .sort((a, b) => b.reduce((sum, site) => sum + site.score, 0) - a.reduce((sum, site) => sum + site.score, 0));
  const selected = selections[0] ?? [];
  if (selected.length !== recipe.planning.settlements) {
    throw new Error(`world planner found ${selected.length} of ${recipe.planning.settlements} required settlement sites`);
  }
  const settlements = selected.map((site, index) => ({
    id: `settlement-${String(index + 1).padStart(2, "0")}`,
    name: `Frontier Hold ${index + 1}`,
    x: site.x + 0.5,
    y: site.y + 0.5,
    suitability: round(site.score),
  }));
  const trails = connectSettlements(settlements, bundle, recipe);
  return applyFeatureAuthority(bundle, settlements, trails, "duskfell-suitability-astar-v1");
}

export function applyAuthoredFeatures(input, recipe, features) {
  const settlements = structuredClone(features?.settlements ?? []);
  const trails = structuredClone(features?.trails ?? []);
  if (settlements.length !== recipe.planning.settlements) {
    throw new Error(`authored settlement count ${settlements.length} does not match recipe count ${recipe.planning.settlements}`);
  }
  if (trails.length !== Math.max(0, settlements.length - 1)) {
    throw new Error("authored trail network must contain exactly one fewer trail than settlements");
  }
  return applyFeatureAuthority(structuredClone(input), settlements, trails, "duskfell-authored-features-v1");
}

function applyFeatureAuthority(bundle, settlements, trails, algorithm) {
  const { cols, rows } = bundle.dimensions;
  const settlementField = field(rows, cols, 0);
  const trailField = field(rows, cols, 0);
  for (const settlement of settlements) {
    const sx = Math.floor(settlement.x);
    const sy = Math.floor(settlement.y);
    for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
      const x = sx + dx;
      const y = sy + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      settlementField[y][x] = Math.max(settlementField[y][x], round(Math.max(0, 1 - Math.hypot(dx, dy) / 3.5)));
    }
  }
  for (const trail of trails) {
    for (const point of trail.points) {
      const x = Math.floor(point.x);
      const y = Math.floor(point.y);
      trailField[y][x] = 1;
      for (const [dx, dy] of D8) {
        if (trailField[y + dy]?.[x + dx] !== undefined) trailField[y + dy][x + dx] = Math.max(trailField[y + dy][x + dx], 0.34);
      }
    }
  }
  bundle.fields.settlement = settlementField;
  bundle.fields.trail = trailField;
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    bundle.fields.disturbance[y][x] = round(Math.max(bundle.fields.disturbance[y][x], trailField[y][x] * 0.55, settlementField[y][x] * 0.8));
  }
  applyPlanningMaterials(bundle, settlements, trails);
  bundle.features = {
    schema: "duskfell-world-features-v1",
    settlements,
    trails,
  };
  bundle.generation.planning = {
    algorithm,
    settlementCount: settlements.length,
    trailCount: trails.length,
  };
  const weightedBundle = attachMaterialWeights(bundle);
  weightedBundle.contentSha256 = crypto.createHash("sha256").update(JSON.stringify(weightedBundle)).digest("hex");
  return weightedBundle;
}

function selectSettlements(candidates, count, requestedSpacing) {
  const selected = [];
  for (const candidate of candidates) {
    if (selected.every((site) => Math.hypot(site.x - candidate.x, site.y - candidate.y) >= requestedSpacing)) selected.push(candidate);
    if (selected.length === count) return selected;
  }
  return selected;
}

function connectSettlements(settlements, bundle, recipe) {
  const connected = new Set([0]);
  const remaining = new Set(settlements.map((_, index) => index).slice(1));
  const trails = [];
  while (remaining.size > 0) {
    const pairs = [];
    for (const from of connected) for (const to of remaining) {
      pairs.push({ from, to, distance: Math.hypot(settlements[from].x - settlements[to].x, settlements[from].y - settlements[to].y) });
    }
    pairs.sort((a, b) => a.distance - b.distance || a.from - b.from || a.to - b.to);
    let route = null;
    let pair = null;
    for (const candidate of pairs) {
      route = findTrail(settlements[candidate.from], settlements[candidate.to], bundle, recipe);
      if (route) {
        pair = candidate;
        break;
      }
    }
    if (!route || !pair) throw new Error("world planner could not connect all settlements with navigable trails");
    const bridges = route.filter((point) => authoritativeWater(bundle, point.x, point.y) > 0.3);
    trails.push({
      id: `trail-${String(trails.length + 1).padStart(2, "0")}`,
      from: settlements[pair.from].id,
      to: settlements[pair.to].id,
      width: recipe.planning.trailWidth,
      points: route,
      bridges,
    });
    connected.add(pair.to);
    remaining.delete(pair.to);
  }
  return trails;
}

function findTrail(from, to, bundle, recipe) {
  const { cols, rows } = bundle.dimensions;
  const start = Math.floor(from.y) * cols + Math.floor(from.x);
  const goal = Math.floor(to.y) * cols + Math.floor(to.x);
  const g = new Float64Array(cols * rows).fill(Infinity);
  const cameFrom = new Int32Array(cols * rows).fill(-1);
  const closed = new Uint8Array(cols * rows);
  const open = new MinHeap();
  g[start] = 0;
  open.push({ index: start, priority: 0 });
  while (open.length > 0) {
    const current = open.pop().index;
    if (closed[current]) continue;
    if (current === goal) return reconstructTrail(cameFrom, current, cols);
    closed[current] = 1;
    const x = current % cols;
    const y = Math.floor(current / cols);
    for (const [dx, dy] of D8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const next = ny * cols + nx;
      if (closed[next]) continue;
      const slope = bundle.fields.slope[ny][nx];
      const water = authoritativeWater(bundle, nx, ny);
      if (slope > recipe.planning.maxTrailSlope) continue;
      const step = Math.hypot(dx, dy) * (
        1 +
        slope * 7 +
        bundle.fields.rockiness[ny][nx] * 2.2 +
        bundle.fields.snow[ny][nx] * 2 +
        water * 24
      );
      const tentative = g[current] + step;
      if (tentative >= g[next]) continue;
      cameFrom[next] = current;
      g[next] = tentative;
      const heuristic = Math.hypot(nx - (goal % cols), ny - Math.floor(goal / cols));
      open.push({ index: next, priority: tentative + heuristic });
    }
  }
  return null;
}

function authoritativeWater(bundle, x, y) {
  const tileX = Math.max(0, Math.min(bundle.dimensions.cols - 1, Math.floor(x)));
  const tileY = Math.max(0, Math.min(bundle.dimensions.rows - 1, Math.floor(y)));
  return waterAtTile(bundle.waterAuthority, tileX, tileY, bundle.fields.water[tileY][tileX]);
}

function reconstructTrail(cameFrom, current, cols) {
  const points = [];
  while (current >= 0) {
    points.push({ x: current % cols + 0.5, y: Math.floor(current / cols) + 0.5 });
    current = cameFrom[current];
  }
  return points.reverse();
}

function applyPlanningMaterials(bundle, settlements, trails) {
  const rows = bundle.legacy.materialGrid.map((row) => [...row]);
  for (const trail of trails) for (const point of trail.points) {
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    if (authoritativeWater(bundle, x, y) < 0.3) rows[y][x] = MATERIAL_DIRT;
  }
  for (const settlement of settlements) {
    const sx = Math.floor(settlement.x);
    const sy = Math.floor(settlement.y);
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const x = sx + dx;
      const y = sy + dy;
      if (rows[y]?.[x] !== undefined && authoritativeWater(bundle, x, y) < 0.3) rows[y][x] = MATERIAL_COBBLE;
    }
  }
  bundle.legacy.materialGrid = rows.map((row) => row.join(""));
}

function distanceFromWater(water, cols, rows) {
  const result = field(rows, cols, Infinity);
  const queue = [];
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    if (water[y][x] > 0.45) {
      result[y][x] = 0;
      queue.push({ x, y });
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const { x, y } = queue[head];
    for (const [dx, dy] of D8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const distance = result[y][x] + Math.hypot(dx, dy);
      if (distance >= result[ny][nx]) continue;
      result[ny][nx] = distance;
      queue.push({ x: nx, y: ny });
    }
  }
  return result;
}

function traversableComponents(slope, maxSlope, cols, rows) {
  const labels = field(rows, cols, -1);
  let component = 0;
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    if (labels[y][x] >= 0 || slope[y][x] > maxSlope) continue;
    labels[y][x] = component;
    const queue = [{ x, y }];
    for (let head = 0; head < queue.length; head += 1) {
      const point = queue[head];
      for (const [dx, dy] of D8) {
        const nx = point.x + dx;
        const ny = point.y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (labels[ny][nx] >= 0 || slope[ny][nx] > maxSlope) continue;
        labels[ny][nx] = component;
        queue.push({ x: nx, y: ny });
      }
    }
    component += 1;
  }
  return labels;
}

class MinHeap {
  #items = [];

  get length() { return this.#items.length; }

  push(item) {
    this.#items.push(item);
    let index = this.#items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!less(item, this.#items[parent])) break;
      this.#items[index] = this.#items[parent];
      index = parent;
    }
    this.#items[index] = item;
  }

  pop() {
    const root = this.#items[0];
    const last = this.#items.pop();
    if (this.#items.length === 0) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.#items.length) break;
      const child = right < this.#items.length && less(this.#items[right], this.#items[left]) ? right : left;
      if (!less(this.#items[child], last)) break;
      this.#items[index] = this.#items[child];
      index = child;
    }
    this.#items[index] = last;
    return root;
  }
}

function less(a, b) {
  return a.priority < b.priority || (a.priority === b.priority && a.index < b.index);
}

function field(rows, cols, value) {
  return Array.from({ length: rows }, () => Array(cols).fill(value));
}

function hash01(x, y, seed) {
  let value = Math.imul(x + 0x9e3779b9, 374761393) ^ Math.imul(y + seed, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}
