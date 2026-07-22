import { readFile, writeFile } from "node:fs/promises";

const worldPath = process.argv[2] ?? "server/data/world.json";
const world = JSON.parse(await readFile(worldPath, "utf8"));
const terrain = world?.map?.terrain;
if (!terrain?.materialGrid?.length || !terrain?.vertexHeights?.length) {
  throw new Error("run npm run terrain:grid before generating trails");
}

const units = terrain.unitsPerTile;
const rows = terrain.materialGrid.length;
const cols = [...terrain.materialGrid[0]].length;
const objectById = new Map(world.objects.map((object) => [object.id, object]));
const tileOfWorldPoint = (point) => ({ x: Math.floor(point.x / units), y: Math.floor(point.y / units) });
const anchor = (id) => {
  const object = objectById.get(id);
  if (!object) throw new Error(`missing route anchor object ${id}`);
  return tileOfWorldPoint(object);
};

const routes = [
  {
    id: "old-road",
    label: "Old Road",
    kind: "road",
    widthTiles: 1.35,
    anchors: [tileOfWorldPoint(world.spawn), { x: 106, y: 42 }],
  },
  {
    id: "grove-track",
    label: "Grove Track",
    kind: "trail",
    widthTiles: 0.85,
    anchors: [tileOfWorldPoint(world.spawn), anchor("north-grove")],
  },
  {
    id: "southern-way",
    label: "Southern Way",
    kind: "trail",
    widthTiles: 0.9,
    anchors: [tileOfWorldPoint(world.spawn), { x: 68, y: 116 }],
  },
  {
    id: "fen-trail",
    label: "Fen Trail",
    kind: "trail",
    widthTiles: 0.75,
    anchors: [tileOfWorldPoint(world.spawn), { x: 155, y: 86 }],
  },
  {
    id: "western-pass",
    label: "Western Pass",
    kind: "trail",
    widthTiles: 0.8,
    anchors: [tileOfWorldPoint(world.spawn), { x: 28, y: 76 }],
  },
];

const materialAt = (x, y) => {
  if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
  return terrain.materials[Number.parseInt(terrain.materialGrid[y][x], 36)];
};
const heightAt = (x, y) => (
  terrain.vertexHeights[y][x]
  + terrain.vertexHeights[y][x + 1]
  + terrain.vertexHeights[y + 1][x]
  + terrain.vertexHeights[y + 1][x + 1]
) / 4;
const isWalkable = (x, y) => {
  const material = materialAt(x, y);
  return material != null && material !== "water" && material !== "rock";
};

function nearestWalkable(target, radius = 20) {
  if (isWalkable(target.x, target.y)) return target;
  let best = null;
  for (let y = Math.max(0, target.y - radius); y <= Math.min(rows - 1, target.y + radius); y += 1) {
    for (let x = Math.max(0, target.x - radius); x <= Math.min(cols - 1, target.x + radius); x += 1) {
      if (!isWalkable(x, y)) continue;
      const distance = Math.hypot(x - target.x, y - target.y);
      if (!best || distance < best.distance) best = { x, y, distance };
    }
  }
  if (!best) throw new Error(`no walkable tile near ${target.x},${target.y}`);
  return { x: best.x, y: best.y };
}

class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].score <= item.score) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }
  pop() {
    const root = this.items[0];
    const tail = this.items.pop();
    if (!this.items.length) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.items.length) break;
      const child = right < this.items.length && this.items[right].score < this.items[left].score ? right : left;
      if (this.items[child].score >= tail.score) break;
      this.items[index] = this.items[child];
      index = child;
    }
    this.items[index] = tail;
    return root;
  }
  get length() { return this.items.length; }
}

const keyOf = (x, y) => y * cols + x;
const pointOf = (key) => ({ x: key % cols, y: Math.floor(key / cols) });
const directions = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

function routeBetween(rawStart, rawGoal) {
  const start = nearestWalkable(rawStart);
  const goal = nearestWalkable(rawGoal);
  const startKey = keyOf(start.x, start.y);
  const goalKey = keyOf(goal.x, goal.y);
  const frontier = new MinHeap();
  const cost = new Map([[startKey, 0]]);
  const cameFrom = new Map();
  frontier.push({ key: startKey, score: 0 });
  let closestKey = startKey;
  let closestDistance = Math.hypot(goal.x - start.x, goal.y - start.y);

  while (frontier.length) {
    const currentKey = frontier.pop().key;
    const current = pointOf(currentKey);
    const distanceToGoal = Math.hypot(goal.x - current.x, goal.y - current.y);
    if (distanceToGoal < closestDistance) {
      closestDistance = distanceToGoal;
      closestKey = currentKey;
    }
    if (currentKey === goalKey) {
      closestKey = goalKey;
      break;
    }
    const currentCost = cost.get(currentKey);
    for (const [dx, dy] of directions) {
      const x = current.x + dx;
      const y = current.y + dy;
      if (!isWalkable(x, y)) continue;
      const elevationStep = Math.abs(heightAt(x, y) - heightAt(current.x, current.y));
      if (elevationStep > terrain.maxWalkableStep) continue;
      if (dx !== 0 && dy !== 0 && (!isWalkable(current.x + dx, current.y) || !isWalkable(current.x, current.y + dy))) {
        continue;
      }
      const material = materialAt(x, y);
      const materialCost = material === "shore" ? 1.4 : material === "ruin" ? 0.3 : 0;
      const nextCost = currentCost + Math.hypot(dx, dy) + elevationStep * 0.7 + materialCost;
      const nextKey = keyOf(x, y);
      if (nextCost >= (cost.get(nextKey) ?? Infinity)) continue;
      cost.set(nextKey, nextCost);
      cameFrom.set(nextKey, currentKey);
      frontier.push({
        key: nextKey,
        score: nextCost + Math.hypot(goal.x - x, goal.y - y),
      });
    }
  }

  const reached = pointOf(closestKey);
  if (closestKey !== goalKey) {
    console.warn(`approaching blocked anchor ${rawGoal.x},${rawGoal.y} at reachable ${reached.x},${reached.y}`);
  }
  const path = [reached];
  let cursor = closestKey;
  while (cursor !== startKey) {
    cursor = cameFrom.get(cursor);
    path.push(pointOf(cursor));
  }
  return path.reverse();
}

function rasterLine(start, end) {
  const points = [];
  const steps = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  for (let index = 0; index <= steps; index += 1) {
    const t = steps === 0 ? 0 : index / steps;
    const point = {
      x: Math.round(start.x + (end.x - start.x) * t),
      y: Math.round(start.y + (end.y - start.y) * t),
    };
    if (!points.length || points.at(-1).x !== point.x || points.at(-1).y !== point.y) points.push(point);
  }
  return points;
}

function hasLineOfSight(start, end) {
  const line = rasterLine(start, end);
  for (let index = 0; index < line.length; index += 1) {
    if (!isWalkable(line[index].x, line[index].y)) return false;
    if (index > 0 && Math.abs(heightAt(line[index].x, line[index].y) - heightAt(line[index - 1].x, line[index - 1].y)) > terrain.maxWalkableStep) {
      return false;
    }
  }
  return true;
}

function simplify(path) {
  const maxSegmentTiles = 12;
  const result = [path[0]];
  let start = 0;
  while (start < path.length - 1) {
    let end = Math.min(path.length - 1, start + maxSegmentTiles);
    while (end > start + 1 && !hasLineOfSight(path[start], path[end])) end -= 1;
    result.push(path[end]);
    start = end;
  }
  return result;
}

const generated = routes.map((route) => {
  let path = [];
  let current = route.anchors[0];
  for (let index = 0; index < route.anchors.length - 1; index += 1) {
    const leg = routeBetween(current, route.anchors[index + 1]);
    path.push(...(path.length ? leg.slice(1) : leg));
    current = leg.at(-1);
  }
  const points = simplify(path).map((point) => ({ x: point.x + 0.5, y: point.y + 0.5 }));
  if (points.length > 64) throw new Error(`${route.id} simplified to ${points.length} points; maximum is 64`);
  console.log(`${route.id}: ${path.length} tiles -> ${points.length} control points`);
  return {
    id: route.id,
    label: route.label,
    kind: route.kind,
    widthTiles: route.widthTiles,
    points,
  };
});

terrain.trails = generated;
await writeFile(worldPath, `${JSON.stringify(world, null, 2)}\n`);
console.log(`wrote ${generated.length} terrain-aware trails to ${worldPath}`);
