export const D8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const CARDINAL_EDGES = [
  { dx: 0, dy: -1, a: [0, 0], b: [1, 0] },
  { dx: 1, dy: 0, a: [1, 0], b: [1, 1] },
  { dx: 0, dy: 1, a: [1, 1], b: [0, 1] },
  { dx: -1, dy: 0, a: [0, 1], b: [0, 0] },
];

export function calculatePriorityFlood(elevation, width, height) {
  const cells = width * height;
  if (elevation.length !== cells) throw new Error("priority-flood elevation dimensions are invalid");
  const directions = new Int8Array(cells).fill(-1);
  const filled = Float64Array.from(elevation);
  const visited = new Uint8Array(cells);
  const queue = new MinHeap();
  const pushBoundary = (x, y) => {
    const index = y * width + x;
    if (visited[index]) return;
    visited[index] = 1;
    queue.push({ elevation: filled[index], index });
  };
  for (let x = 0; x < width; x += 1) {
    pushBoundary(x, 0);
    pushBoundary(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    pushBoundary(0, y);
    pushBoundary(width - 1, y);
  }
  const epsilon = 1e-7;
  while (queue.length > 0) {
    const current = queue.pop();
    const x = current.index % width;
    const y = Math.floor(current.index / width);
    for (let direction = 0; direction < D8.length; direction += 1) {
      const [dx, dy] = D8[direction];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (visited[next]) continue;
      visited[next] = 1;
      filled[next] = Math.max(filled[next], current.elevation + epsilon);
      directions[next] = (direction + 4) % D8.length;
      queue.push({ elevation: filled[next], index: next });
    }
  }
  const accumulation = new Float64Array(cells).fill(1);
  const order = Array.from({ length: cells }, (_, index) => index).sort((a, b) => filled[b] - filled[a] || b - a);
  for (const index of order) {
    const next = downstreamIndex(index, directions, width, height);
    if (next >= 0) accumulation[next] += accumulation[index];
  }
  const fillDepth = Float64Array.from(filled, (value, index) => Math.max(0, value - elevation[index]));
  return { directions, accumulation, fillDepth, filled };
}

export function extractTributaries({ directions, accumulation, width, height, riverCenterline, maxTributaries = 6, minimumTiles = 4 }) {
  const major = new Uint8Array(width * height);
  for (const point of riverCenterline ?? []) {
    const x = clampInt(Math.floor(point.x), 0, width - 1);
    const y = clampInt(Math.floor(point.y), 0, height - 1);
    major[y * width + x] = 1;
    for (const [dx, dy] of D8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) major[ny * width + nx] = 1;
    }
  }
  const predecessors = Array.from({ length: width * height }, () => []);
  for (let index = 0; index < width * height; index += 1) {
    const next = downstreamIndex(index, directions, width, height);
    if (next >= 0) predecessors[next].push(index);
  }
  const candidates = [];
  for (let index = 0; index < width * height; index += 1) {
    if (major[index]) continue;
    const next = downstreamIndex(index, directions, width, height);
    if (next < 0 || !major[next]) continue;
    const reverse = [index];
    let current = index;
    const seen = new Set(reverse);
    while (reverse.length < width + height) {
      const upstream = predecessors[current]
        .filter((candidate) => !major[candidate] && !seen.has(candidate))
        .sort((left, right) => accumulation[right] - accumulation[left] || left - right)[0];
      if (upstream === undefined) break;
      reverse.push(upstream);
      seen.add(upstream);
      current = upstream;
    }
    if (reverse.length < minimumTiles) continue;
    const points = reverse.reverse().map((cell) => ({ x: cell % width + 0.5, y: Math.floor(cell / width) + 0.5 }));
    const confluence = { x: next % width + 0.5, y: Math.floor(next / width) + 0.5 };
    points.push(confluence);
    candidates.push({ points, confluence, accumulation: accumulation[index], cells: new Set(reverse) });
  }
  candidates.sort((left, right) => right.accumulation - left.accumulation || right.points.length - left.points.length || left.points[0].y - right.points[0].y || left.points[0].x - right.points[0].x);
  const selected = [];
  const claimed = new Set();
  const claimedBuffer = new Set();
  const minimumConfluenceSpacing = Math.max(6, Math.min(14, Math.floor(Math.min(width, height) * 0.11)));
  const bufferRadius = Math.max(2, Math.min(4, Math.floor(Math.min(width, height) / 32)));
  for (const candidate of candidates) {
    const overlap = [...candidate.cells].filter((cell) => claimed.has(cell)).length;
    const proximity = [...candidate.cells].filter((cell) => claimedBuffer.has(cell)).length;
    if (overlap > candidate.cells.size * 0.25 || proximity > candidate.cells.size * 0.15) continue;
    if (selected.some((tributary) => Math.hypot(tributary.confluence.x - candidate.confluence.x, tributary.confluence.y - candidate.confluence.y) < minimumConfluenceSpacing)) continue;
    for (const cell of candidate.cells) {
      claimed.add(cell);
      const x = cell % width;
      const y = Math.floor(cell / width);
      for (let dy = -bufferRadius; dy <= bufferRadius; dy += 1) for (let dx = -bufferRadius; dx <= bufferRadius; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) claimedBuffer.add(ny * width + nx);
      }
    }
    selected.push({
      id: `tributary-${String(selected.length + 1).padStart(2, "0")}`,
      order: Math.max(1, Math.min(4, 1 + Math.floor(Math.log2(Math.max(1, candidate.accumulation)) / 3))),
      sourceAccumulation: round(candidate.accumulation, 3),
      points: candidate.points,
      confluence: candidate.confluence,
    });
    if (selected.length === maxTributaries) break;
  }
  return selected;
}

export function buildHydrologyAuthority({ directions, accumulation, water, lake, tributaries = [], watershedOutletBucketTiles, shorelineThreshold = 0.45 }) {
  const height = water.length;
  const width = water[0].length;
  const { basinIds, basins } = deriveWatersheds(directions, width, height, watershedOutletBucketTiles);
  const waterBodies = deriveLakeBodies(lake, directions, accumulation, width, height, shorelineThreshold);
  const shorelineSegments = deriveShorelines(water, lake, width, height, shorelineThreshold);
  const basinByTile = (point) => basinIds[Math.floor(point.y)]?.[Math.floor(point.x)] ?? 0;
  return {
    schema: "duskfell-hydrology-authority-v1",
    algorithm: "priority-flood-d8-watershed-v1",
    watersheds: { basinIds, basins },
    tributaries: tributaries.map((tributary) => ({ ...tributary, watershedId: basinByTile(tributary.points[0]) })),
    waterBodies,
    shorelineThreshold,
    shorelineSegments,
  };
}

function deriveWatersheds(directions, width, height, requestedBucketSize) {
  const terminalMemo = new Int32Array(width * height).fill(-2);
  const terminal = (start) => {
    if (terminalMemo[start] !== -2) return terminalMemo[start];
    const path = [];
    const seen = new Set();
    let current = start;
    while (current >= 0 && terminalMemo[current] === -2 && !seen.has(current)) {
      path.push(current);
      seen.add(current);
      const next = downstreamIndex(current, directions, width, height);
      if (next < 0) break;
      current = next;
    }
    const outlet = current >= 0 && terminalMemo[current] >= 0 ? terminalMemo[current] : path.at(-1);
    for (const index of path) terminalMemo[index] = outlet;
    return outlet;
  };
  const bucketSize = requestedBucketSize ?? Math.max(4, Math.floor(Math.min(width, height) / 8));
  const outletKey = (outlet) => {
    const x = outlet % width;
    const y = Math.floor(outlet / width);
    if (y === 0) return `north:${Math.floor(x / bucketSize)}`;
    if (y === height - 1) return `south:${Math.floor(x / bucketSize)}`;
    if (x === 0) return `west:${Math.floor(y / bucketSize)}`;
    if (x === width - 1) return `east:${Math.floor(y / bucketSize)}`;
    return `sink:${outlet}`;
  };
  const groups = new Map();
  for (let index = 0; index < width * height; index += 1) {
    const outlet = terminal(index);
    const key = outletKey(outlet);
    const group = groups.get(key) ?? { cells: [], terminals: new Map() };
    group.cells.push(index);
    group.terminals.set(outlet, (group.terminals.get(outlet) ?? 0) + 1);
    groups.set(key, group);
  }
  const ordered = [...groups.entries()].sort((left, right) => right[1].cells.length - left[1].cells.length || left[0].localeCompare(right[0]));
  const keyToId = new Map(ordered.map(([key], index) => [key, index + 1]));
  const basinIds = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => keyToId.get(outletKey(terminalMemo[y * width + x]))));
  const basins = ordered.map(([key, group], index) => {
    const outlet = [...group.terminals.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0][0];
    return {
      id: index + 1,
      outletGroup: key,
      tiles: group.cells.length,
      outlet: { x: outlet % width + 0.5, y: Math.floor(outlet / width) + 0.5 },
      bounds: {
        minX: Math.min(...group.cells.map((cell) => cell % width)),
        minY: Math.min(...group.cells.map((cell) => Math.floor(cell / width))),
        maxX: Math.max(...group.cells.map((cell) => cell % width)),
        maxY: Math.max(...group.cells.map((cell) => Math.floor(cell / width))),
      },
    };
  });
  return { basinIds, basins };
}

function deriveLakeBodies(lake, directions, accumulation, width, height, threshold) {
  const seen = new Uint8Array(width * height);
  const bodies = [];
  for (let start = 0; start < width * height; start += 1) {
    const sx = start % width;
    const sy = Math.floor(start / width);
    if (seen[start] || lake[sy][sx] <= threshold) continue;
    const cells = [];
    const queue = [start];
    seen[start] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      cells.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      for (const [dx, dy] of D8) {
        const nx = x + dx;
        const ny = y + dy;
        const next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[next] || lake[ny][nx] <= threshold) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    if (cells.length < 2) continue;
    const cellSet = new Set(cells);
    const exits = cells.map((index) => ({ index, next: downstreamIndex(index, directions, width, height) }))
      .filter(({ next }) => next >= 0 && !cellSet.has(next))
      .sort((left, right) => accumulation[right.index] - accumulation[left.index] || left.index - right.index);
    const outlet = exits[0];
    bodies.push({
      id: `water-body-${String(bodies.length + 1).padStart(2, "0")}`,
      kind: "lake",
      tiles: cells.length,
      bounds: {
        minX: Math.min(...cells.map((cell) => cell % width)),
        minY: Math.min(...cells.map((cell) => Math.floor(cell / width))),
        maxX: Math.max(...cells.map((cell) => cell % width)),
        maxY: Math.max(...cells.map((cell) => Math.floor(cell / width))),
      },
      outlet: outlet ? {
        from: { x: outlet.index % width + 0.5, y: Math.floor(outlet.index / width) + 0.5 },
        to: { x: outlet.next % width + 0.5, y: Math.floor(outlet.next / width) + 0.5 },
        accumulation: round(accumulation[outlet.index], 3),
      } : null,
    });
  }
  return bodies;
}

function deriveShorelines(water, lake, width, height, threshold) {
  const segments = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (water[y][x] <= threshold) continue;
    for (const edge of CARDINAL_EDGES) {
      const nx = x + edge.dx;
      const ny = y + edge.dy;
      if (water[ny]?.[nx] > threshold) continue;
      segments.push({
        a: { x: x + edge.a[0], y: y + edge.a[1] },
        b: { x: x + edge.b[0], y: y + edge.b[1] },
        kind: lake[y][x] > threshold ? "lake" : "river",
      });
    }
  }
  return segments;
}

function downstreamIndex(index, directions, width, height) {
  const direction = directions[index];
  if (!Number.isInteger(direction) || direction < 0 || direction >= D8.length) return -1;
  const x = index % width;
  const y = Math.floor(index / width);
  const [dx, dy] = D8[direction];
  const nx = x + dx;
  const ny = y + dy;
  return nx < 0 || ny < 0 || nx >= width || ny >= height ? -1 : ny * width + nx;
}

class MinHeap {
  #items = [];
  get length() { return this.#items.length; }
  push(item) {
    this.#items.push(item);
    let index = this.#items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!heapLess(item, this.#items[parent])) break;
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
      const child = right < this.#items.length && heapLess(this.#items[right], this.#items[left]) ? right : left;
      if (!heapLess(this.#items[child], last)) break;
      this.#items[index] = this.#items[child];
      index = child;
    }
    this.#items[index] = last;
    return root;
  }
}

function heapLess(left, right) {
  return left.elevation < right.elevation || (left.elevation === right.elevation && left.index < right.index);
}

function clampInt(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, digits = 4) { return Number(value.toFixed(digits)); }
