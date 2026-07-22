import { verifySha256Bytes } from "./asset-integrity.js";

const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_PATH = /^chunks\/visual-illustrated\/chunk-(\d+)-(\d+)\.png$/;
const runtimeFetch = (input, init) => globalThis.fetch(input, init);

export function normalizeWorldVisualChunkIndex(value, expectedWorld) {
  if (value?.schema !== "duskfell-chunk-visual-illustrated-index-v1"
    || value?.role !== "illustrated"
    || value?.world !== expectedWorld) {
    throw new Error("world visual chunk index identity is invalid");
  }
  if (!SHA256.test(value?.sourceBundleContentSha256 ?? "")
    || !SHA256.test(value?.sourceChunkIndexSha256 ?? "")
    || !SHA256.test(value?.sourceRaster?.sha256 ?? "")) {
    throw new Error("world visual chunk source hashes are invalid");
  }
  if (!Number.isInteger(value.chunkTiles) || value.chunkTiles < 8 || value.chunkTiles > 128
    || !Number.isInteger(value.apronTiles) || value.apronTiles < 1 || value.apronTiles > 32) {
    throw new Error("world visual chunk geometry is invalid");
  }
  const pixelsPerTile = value.sourceRaster?.pixelsPerTile;
  if (!Number.isInteger(pixelsPerTile) || pixelsPerTile < 1 || pixelsPerTile > 64) {
    throw new Error("world visual chunk resolution is invalid");
  }
  if (!Number.isInteger(value.grid?.cols) || value.grid.cols < 1
    || !Number.isInteger(value.grid?.rows) || value.grid.rows < 1) {
    throw new Error("world visual chunk grid is invalid");
  }
  const expectedCount = value.grid.cols * value.grid.rows;
  if (!Array.isArray(value.entries) || value.entries.length !== expectedCount || expectedCount > 65_536) {
    throw new Error("world visual chunk entry count is invalid");
  }

  const entries = new Map();
  for (const entry of value.entries) {
    const match = IMAGE_PATH.exec(entry?.image?.path ?? "");
    const key = `${entry?.coord?.x},${entry?.coord?.y}`;
    if (!match || Number(match[1]) !== entry.coord?.x || Number(match[2]) !== entry.coord?.y
      || entry.id !== `${entry.coord.x}-${entry.coord.y}` || entries.has(key)) {
      throw new Error("world visual chunk entry identity is invalid or duplicated");
    }
    if (!SHA256.test(entry.image.sha256 ?? "") || !Number.isInteger(entry.image.bytes)
      || entry.image.bytes < 64 || entry.image.bytes > 32 * 1024 * 1024) {
      throw new Error(`world visual chunk ${entry.id} integrity metadata is invalid`);
    }
    if (entry.image.pixelsPerTile !== pixelsPerTile
      || entry.image.width !== entry.sample?.cols * pixelsPerTile
      || entry.image.height !== entry.sample?.rows * pixelsPerTile) {
      throw new Error(`world visual chunk ${entry.id} dimensions are invalid`);
    }
    const expectedCoreCrop = {
      x: (entry.core.x - entry.sample.x) * pixelsPerTile,
      y: (entry.core.y - entry.sample.y) * pixelsPerTile,
      width: entry.core.cols * pixelsPerTile,
      height: entry.core.rows * pixelsPerTile,
    };
    if (JSON.stringify(entry.coreCrop) !== JSON.stringify(expectedCoreCrop)) {
      throw new Error(`world visual chunk ${entry.id} core crop is invalid`);
    }
    entries.set(key, structuredClone(entry));
  }
  return {
    schema: value.schema,
    role: value.role,
    world: value.world,
    sourceBundleContentSha256: value.sourceBundleContentSha256,
    sourceChunkIndexSha256: value.sourceChunkIndexSha256,
    sourceRaster: structuredClone(value.sourceRaster),
    chunkTiles: value.chunkTiles,
    apronTiles: value.apronTiles,
    grid: structuredClone(value.grid),
    entries,
  };
}

export async function openWorldVisualChunkStream({
  root,
  indexReference,
  world,
  fetchImpl = runtimeFetch,
  decodeImage = decodePngBytes,
  maxCachedChunks = 16,
}) {
  if (indexReference?.path !== "chunks/visual-illustrated/index.json"
    || !SHA256.test(indexReference?.sha256 ?? "")) {
    throw new Error("runtime visual chunk-index reference is invalid");
  }
  const index = normalizeWorldVisualChunkIndex(
    await loadVerifiedJson(`${root}/${indexReference.path}`, indexReference.sha256, fetchImpl),
    world,
  );
  return new WorldVisualChunkStream({ root, index, fetchImpl, decodeImage, maxCachedChunks });
}

export class WorldVisualChunkStream {
  constructor({ root, index, fetchImpl = runtimeFetch, decodeImage = decodePngBytes, maxCachedChunks = 16 }) {
    if (!Number.isInteger(maxCachedChunks) || maxCachedChunks < 9 || maxCachedChunks > 256) {
      throw new Error("world visual chunk cache size must be between 9 and 256");
    }
    this.root = root.replace(/\/+$/, "");
    this.index = index;
    this.fetchImpl = fetchImpl;
    this.decodeImage = decodeImage;
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
    if (!Number.isFinite(tileX) || !Number.isFinite(tileY)
      || !Number.isInteger(radiusChunks) || radiusChunks < 0 || radiusChunks > 3) {
      throw new Error("world visual chunk window request is invalid");
    }
    if ((radiusChunks * 2 + 1) ** 2 > this.maxCachedChunks) {
      throw new Error("world visual chunk window exceeds the bounded cache");
    }
    const centerX = Math.floor(tileX / this.index.chunkTiles);
    const centerY = Math.floor(tileY / this.index.chunkTiles);
    const coordinates = [];
    for (let y = centerY - radiusChunks; y <= centerY + radiusChunks; y += 1) {
      for (let x = centerX - radiusChunks; x <= centerX + radiusChunks; x += 1) {
        if (this.index.entries.has(`${x},${y}`)) coordinates.push({ x, y });
      }
    }
    const chunks = await Promise.all(coordinates.map(({ x, y }) => this.loadChunk(x, y)));
    return new Map(coordinates.map((coord, index) => [`${coord.x},${coord.y}`, chunks[index]]));
  }

  async prefetchAhead({ tileX, tileY, velocityX = 0, velocityY = 0, radiusChunks = 1 }) {
    const lead = this.index.chunkTiles * 0.75;
    const magnitude = Math.hypot(velocityX, velocityY);
    return this.loadWindow({
      tileX: tileX + (magnitude > 1e-6 ? velocityX / magnitude * lead : 0),
      tileY: tileY + (magnitude > 1e-6 ? velocityY / magnitude * lead : 0),
      radiusChunks,
    });
  }

  snapshot() {
    return { ...this.metrics, cached: this.cache.size, inFlight: this.inFlight.size, maxCachedChunks: this.maxCachedChunks };
  }

  async #fetchChunk(entry) {
    this.metrics.requests += 1;
    const response = await this.fetchImpl(`${this.root}/${entry.image.path}`, {
      cache: "no-store",
      headers: { accept: "image/png" },
    });
    if (!response.ok) throw new Error(`world visual chunk ${entry.id} request failed with ${response.status}`);
    const contentType = response.headers?.get?.("content-type") ?? "image/png";
    if (contentType.toLowerCase().split(";", 1)[0].trim() !== "image/png") {
      throw new Error(`world visual chunk ${entry.id} content type is invalid`);
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== entry.image.bytes) throw new Error(`world visual chunk ${entry.id} byte count is invalid`);
    await verifySha256Bytes(bytes, entry.image.sha256);
    const image = await this.decodeImage(bytes, entry);
    const width = image.naturalWidth ?? image.width;
    const height = image.naturalHeight ?? image.height;
    if (width !== entry.image.width || height !== entry.image.height) {
      throw new Error(`world visual chunk ${entry.id} decoded dimensions are invalid`);
    }
    const value = { entry, image };
    const key = `${entry.coord.x},${entry.coord.y}`;
    this.cache.delete(key);
    this.cache.set(key, value);
    this.metrics.bytes += bytes.byteLength;
    while (this.cache.size > this.maxCachedChunks) {
      const oldest = this.cache.keys().next().value;
      this.cache.get(oldest)?.image?.close?.();
      this.cache.delete(oldest);
      this.metrics.evictions += 1;
    }
    return value;
  }
}

export function composeWorldVisualChunkWindow(loadedChunks, canvasFactory = defaultCanvasFactory) {
  const chunks = [...loadedChunks.values()].filter(Boolean);
  if (chunks.length === 0) throw new Error("world visual chunk window is empty");
  const pixelsPerTile = chunks[0].entry.image.pixelsPerTile;
  const minX = Math.min(...chunks.map(({ entry }) => entry.sample.x));
  const minY = Math.min(...chunks.map(({ entry }) => entry.sample.y));
  const maxX = Math.max(...chunks.map(({ entry }) => entry.sample.x + entry.sample.cols));
  const maxY = Math.max(...chunks.map(({ entry }) => entry.sample.y + entry.sample.rows));
  if (chunks.some(({ entry }) => entry.image.pixelsPerTile !== pixelsPerTile)) {
    throw new Error("world visual chunk window mixes resolutions");
  }
  const canvas = canvasFactory((maxX - minX) * pixelsPerTile, (maxY - minY) * pixelsPerTile);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("world visual chunk window canvas is unavailable");
  context.imageSmoothingEnabled = false;
  for (const { entry, image } of chunks) {
    context.drawImage(
      image,
      (entry.sample.x - minX) * pixelsPerTile,
      (entry.sample.y - minY) * pixelsPerTile,
    );
  }
  return {
    image: canvas,
    sourceRegion: { offsetX: minX, offsetY: minY, cols: maxX - minX, rows: maxY - minY },
  };
}

async function loadVerifiedJson(url, sha256, fetchImpl) {
  const response = await fetchImpl(url, { cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`world visual chunk index request failed with ${response.status}`);
  const bytes = await response.arrayBuffer();
  await verifySha256Bytes(bytes, sha256);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(`world visual chunk index is malformed: ${error.message}`);
  }
}

async function decodePngBytes(bytes) {
  const blob = new Blob([bytes], { type: "image/png" });
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener("load", () => resolve(image), { once: true });
      image.addEventListener("error", reject, { once: true });
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function defaultCanvasFactory(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
