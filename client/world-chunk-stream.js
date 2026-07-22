import { verifySha256Bytes } from "./asset-integrity.js";

const SHA256 = /^[a-f0-9]{64}$/;
const CHUNK_PATH = /^chunks\/chunk-(\d+)-(\d+)\.json$/;
const runtimeFetch = (input, init) => globalThis.fetch(input, init);

export function normalizeWorldChunkIndex(value, expectedWorld) {
  if (value?.schema !== "duskfell-world-chunk-index-v1" || value?.world !== expectedWorld) throw new Error("world chunk index identity is invalid");
  if (!SHA256.test(value?.sourceBundleContentSha256 ?? "")) throw new Error("world chunk index source hash is invalid");
  const { cols, rows, unitsPerTile } = value.dimensions ?? {};
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1 || unitsPerTile !== 64) throw new Error("world chunk index dimensions are invalid");
  if (!Number.isInteger(value.chunkTiles) || value.chunkTiles < 8 || value.chunkTiles > 128) throw new Error("world chunk tile size is invalid");
  if (!Number.isInteger(value.apronTiles) || value.apronTiles < 1 || value.apronTiles > 32) throw new Error("world chunk apron is invalid");
  const expectedGrid = { cols: Math.ceil(cols / value.chunkTiles), rows: Math.ceil(rows / value.chunkTiles) };
  if (value.grid?.cols !== expectedGrid.cols || value.grid?.rows !== expectedGrid.rows) throw new Error("world chunk grid dimensions are invalid");
  const expectedCount = expectedGrid.cols * expectedGrid.rows;
  if (!Array.isArray(value.chunks) || value.chunks.length !== expectedCount || expectedCount > 65_536) throw new Error("world chunk index count is invalid");
  const entries = new Map();
  for (const entry of value.chunks) {
    const match = CHUNK_PATH.exec(entry?.path ?? "");
    const key = `${entry?.coord?.x},${entry?.coord?.y}`;
    if (!match || Number(match[1]) !== entry.coord?.x || Number(match[2]) !== entry.coord?.y || entry.id !== `${entry.coord.x}-${entry.coord.y}` || entries.has(key)) {
      throw new Error("world chunk entry identity is invalid or duplicated");
    }
    if (!SHA256.test(entry.sha256 ?? "") || !Number.isInteger(entry.bytes) || entry.bytes < 2 || entry.bytes > 8 * 1024 * 1024) throw new Error(`world chunk ${entry.id} integrity metadata is invalid`);
    const core = entry.core;
    const expectedCore = {
      x: entry.coord.x * value.chunkTiles,
      y: entry.coord.y * value.chunkTiles,
      cols: Math.min(value.chunkTiles, cols - entry.coord.x * value.chunkTiles),
      rows: Math.min(value.chunkTiles, rows - entry.coord.y * value.chunkTiles),
    };
    if (JSON.stringify(core) !== JSON.stringify(expectedCore)) throw new Error(`world chunk ${entry.id} core is invalid`);
    const expectedSample = {
      x: Math.max(0, core.x - value.apronTiles),
      y: Math.max(0, core.y - value.apronTiles),
      cols: Math.min(cols, core.x + core.cols + value.apronTiles) - Math.max(0, core.x - value.apronTiles),
      rows: Math.min(rows, core.y + core.rows + value.apronTiles) - Math.max(0, core.y - value.apronTiles),
    };
    if (JSON.stringify(entry.sample) !== JSON.stringify(expectedSample)) throw new Error(`world chunk ${entry.id} sample apron is invalid`);
    entries.set(key, structuredClone(entry));
  }
  return {
    schema: value.schema,
    world: value.world,
    sourceBundleContentSha256: value.sourceBundleContentSha256,
    dimensions: structuredClone(value.dimensions),
    chunkTiles: value.chunkTiles,
    apronTiles: value.apronTiles,
    grid: structuredClone(value.grid),
    entries,
  };
}

export async function openWorldChunkStream({ root, indexReference, world, fetchImpl = runtimeFetch, maxCachedChunks = 16 }) {
  if (indexReference?.path !== "chunks/index.json" || !SHA256.test(indexReference?.sha256 ?? "")) throw new Error("runtime chunk-index reference is invalid");
  const index = normalizeWorldChunkIndex(
    await loadVerifiedJson(`${root}/${indexReference.path}`, indexReference.sha256, fetchImpl),
    world,
  );
  return new WorldChunkStream({ root, index, fetchImpl, maxCachedChunks });
}

export class WorldChunkStream {
  constructor({ root, index, fetchImpl = runtimeFetch, maxCachedChunks = 16 }) {
    if (!Number.isInteger(maxCachedChunks) || maxCachedChunks < 9 || maxCachedChunks > 256) throw new Error("world chunk cache size must be between 9 and 256");
    this.root = root.replace(/\/+$/, "");
    this.index = index;
    this.fetchImpl = fetchImpl;
    this.maxCachedChunks = maxCachedChunks;
    this.cache = new Map();
    this.inFlight = new Map();
    this.metrics = { requests: 0, hits: 0, evictions: 0, bytes: 0 };
  }

  async loadChunk(chunkX, chunkY) {
    const key = `${chunkX},${chunkY}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.metrics.hits += 1;
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const entry = this.index.entries.get(key);
    if (!entry) return null;
    const promise = this.#fetchChunk(entry).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  async loadWindow({ tileX, tileY, radiusChunks = 1 }) {
    if (!Number.isFinite(tileX) || !Number.isFinite(tileY) || !Number.isInteger(radiusChunks) || radiusChunks < 0 || radiusChunks > 3) throw new Error("world chunk window request is invalid");
    const requested = (radiusChunks * 2 + 1) ** 2;
    if (requested > this.maxCachedChunks) throw new Error("world chunk window exceeds the bounded cache");
    const centerX = Math.floor(tileX / this.index.chunkTiles);
    const centerY = Math.floor(tileY / this.index.chunkTiles);
    const coordinates = [];
    for (let y = centerY - radiusChunks; y <= centerY + radiusChunks; y += 1) for (let x = centerX - radiusChunks; x <= centerX + radiusChunks; x += 1) {
      if (this.index.entries.has(`${x},${y}`)) coordinates.push({ x, y });
    }
    const chunks = await Promise.all(coordinates.map(({ x, y }) => this.loadChunk(x, y)));
    return new Map(coordinates.map((coord, index) => [`${coord.x},${coord.y}`, chunks[index]]));
  }

  async prefetchAhead({ tileX, tileY, velocityX = 0, velocityY = 0, radiusChunks = 1 }) {
    const lead = this.index.chunkTiles * 0.75;
    const magnitude = Math.hypot(velocityX, velocityY);
    const targetX = tileX + (magnitude > 1e-6 ? velocityX / magnitude * lead : 0);
    const targetY = tileY + (magnitude > 1e-6 ? velocityY / magnitude * lead : 0);
    return this.loadWindow({ tileX: targetX, tileY: targetY, radiusChunks });
  }

  getChunkAtTile(tileX, tileY) {
    return this.cache.get(`${Math.floor(tileX / this.index.chunkTiles)},${Math.floor(tileY / this.index.chunkTiles)}`) ?? null;
  }

  snapshot() {
    return { ...this.metrics, cached: this.cache.size, inFlight: this.inFlight.size, maxCachedChunks: this.maxCachedChunks };
  }

  clear() {
    this.cache.clear();
  }

  async #fetchChunk(entry) {
    this.metrics.requests += 1;
    const response = await this.fetchImpl(`${this.root}/${entry.path}`, { cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`world chunk ${entry.id} request failed with ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== entry.bytes) throw new Error(`world chunk ${entry.id} byte count is invalid`);
    await verifySha256Bytes(bytes, entry.sha256);
    let chunk;
    try {
      chunk = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      throw new Error(`world chunk ${entry.id} is malformed: ${error.message}`);
    }
    if (chunk?.schema !== "duskfell-world-chunk-v1" || chunk?.world !== this.index.world || chunk?.id !== entry.id || JSON.stringify(chunk.core) !== JSON.stringify(entry.core) || JSON.stringify(chunk.sample) !== JSON.stringify(entry.sample)) {
      throw new Error(`world chunk ${entry.id} authority identity is invalid`);
    }
    const key = `${entry.coord.x},${entry.coord.y}`;
    this.cache.delete(key);
    this.cache.set(key, chunk);
    this.metrics.bytes += bytes.byteLength;
    while (this.cache.size > this.maxCachedChunks) {
      this.cache.delete(this.cache.keys().next().value);
      this.metrics.evictions += 1;
    }
    return chunk;
  }
}

async function loadVerifiedJson(url, sha256, fetchImpl) {
  const response = await fetchImpl(url, { cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`world chunk index request failed with ${response.status}`);
  const bytes = await response.arrayBuffer();
  await verifySha256Bytes(bytes, sha256);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(`world chunk index is malformed: ${error.message}`);
  }
}
