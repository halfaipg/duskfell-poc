import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  composeWorldVisualChunkWindow,
  normalizeWorldVisualChunkIndex,
  openWorldVisualChunkStream,
  WorldVisualChunkStream,
} from "./world-visual-chunk-stream.js";

test("visual chunk index rejects unsafe paths and crop drift", () => {
  const fixture = makeFixture(2, 2);
  const normalized = normalizeWorldVisualChunkIndex(fixture.index, fixture.world);
  assert.equal(normalized.entries.size, 4);
  const unsafe = structuredClone(fixture.index);
  unsafe.entries[0].image.path = "../paint.png";
  assert.throws(() => normalizeWorldVisualChunkIndex(unsafe, fixture.world), /identity/);
  const drifted = structuredClone(fixture.index);
  drifted.entries[0].coreCrop.x += 1;
  assert.throws(() => normalizeWorldVisualChunkIndex(drifted, fixture.world), /core crop/);
});

test("visual chunk stream verifies bytes, deduplicates, and evicts by bounded LRU", async () => {
  const fixture = makeFixture(4, 3);
  const requests = [];
  const stream = new WorldVisualChunkStream({
    root: fixture.root,
    index: normalizeWorldVisualChunkIndex(fixture.index, fixture.world),
    fetchImpl: async (url) => {
      requests.push(url);
      return fixture.responses.has(url) ? binaryResponse(fixture.responses.get(url), "image/png") : { ok: false, status: 404 };
    },
    decodeImage: async (_bytes, entry) => ({ width: entry.image.width, height: entry.image.height }),
    maxCachedChunks: 9,
  });
  const [first, duplicate] = await Promise.all([stream.loadChunk(0, 0), stream.loadChunk(0, 0)]);
  assert.equal(first, duplicate);
  assert.equal(requests.filter((url) => url.endsWith("chunk-0-0.png")).length, 1);
  for (const entry of fixture.index.entries) await stream.loadChunk(entry.coord.x, entry.coord.y);
  assert.equal(stream.snapshot().cached, 9);
  assert.ok(stream.snapshot().evictions >= 3);
});

test("opening a visual stream pins its index and composition preserves sample coordinates", async () => {
  const fixture = makeFixture(2, 1);
  const indexBytes = jsonBytes(fixture.index);
  fixture.responses.set(`${fixture.root}/chunks/visual-illustrated/index.json`, indexBytes);
  const stream = await openWorldVisualChunkStream({
    root: fixture.root,
    world: fixture.world,
    indexReference: { path: "chunks/visual-illustrated/index.json", sha256: digest(indexBytes) },
    fetchImpl: async (url) => fixture.responses.has(url)
      ? binaryResponse(fixture.responses.get(url), url.endsWith(".json") ? "application/json" : "image/png")
      : { ok: false, status: 404 },
    decodeImage: async (_bytes, entry) => ({ width: entry.image.width, height: entry.image.height }),
    maxCachedChunks: 9,
  });
  const chunks = await stream.loadWindow({ tileX: 7, tileY: 4, radiusChunks: 1 });
  const calls = [];
  const composed = composeWorldVisualChunkWindow(chunks, (width, height) => ({
    width,
    height,
    getContext: () => ({ imageSmoothingEnabled: true, drawImage: (...args) => calls.push(args) }),
  }));
  assert.deepEqual(composed.sourceRegion, { offsetX: 0, offsetY: 0, cols: 16, rows: 8 });
  assert.equal(composed.image.width, 64);
  assert.equal(composed.image.height, 32);
  assert.equal(calls.length, 2);
});

function makeFixture(gridCols, gridRows) {
  const world = "visual-proof";
  const root = "/worlds/visual-proof";
  const chunkTiles = 8;
  const apronTiles = 2;
  const pixelsPerTile = 4;
  const cols = gridCols * chunkTiles;
  const rows = gridRows * chunkTiles;
  const responses = new Map();
  const entries = [];
  for (let y = 0; y < gridRows; y += 1) for (let x = 0; x < gridCols; x += 1) {
    const core = { x: x * chunkTiles, y: y * chunkTiles, cols: chunkTiles, rows: chunkTiles };
    const sample = {
      x: Math.max(0, core.x - apronTiles),
      y: Math.max(0, core.y - apronTiles),
      cols: Math.min(cols, core.x + core.cols + apronTiles) - Math.max(0, core.x - apronTiles),
      rows: Math.min(rows, core.y + core.rows + apronTiles) - Math.max(0, core.y - apronTiles),
    };
    const id = `${x}-${y}`;
    const imagePath = `chunks/visual-illustrated/chunk-${id}.png`;
    const imageBytes = Uint8Array.from({ length: 96 + x + y }, (_, index) => (index + x * 17 + y * 31) % 256).buffer;
    responses.set(`${root}/${imagePath}`, imageBytes);
    entries.push({
      id,
      coord: { x, y },
      core,
      sample,
      image: {
        path: imagePath,
        width: sample.cols * pixelsPerTile,
        height: sample.rows * pixelsPerTile,
        pixelsPerTile,
        sha256: digest(imageBytes),
        bytes: imageBytes.byteLength,
      },
      coreCrop: {
        x: (core.x - sample.x) * pixelsPerTile,
        y: (core.y - sample.y) * pixelsPerTile,
        width: core.cols * pixelsPerTile,
        height: core.rows * pixelsPerTile,
      },
    });
  }
  return {
    world,
    root,
    responses,
    index: {
      schema: "duskfell-chunk-visual-illustrated-index-v1",
      role: "illustrated",
      world,
      sourceBundleContentSha256: "a".repeat(64),
      sourceChunkIndexSha256: "b".repeat(64),
      sourceRaster: { path: "illustrated-gameplay.png", sha256: "c".repeat(64), width: cols * pixelsPerTile, height: rows * pixelsPerTile, pixelsPerTile },
      chunkTiles,
      apronTiles,
      grid: { cols: gridCols, rows: gridRows },
      entries,
      seams: [],
    },
  };
}

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).buffer;
}

function digest(value) {
  return crypto.createHash("sha256").update(Buffer.from(value)).digest("hex");
}

function binaryResponse(value, contentType) {
  return {
    ok: true,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? contentType : null },
    arrayBuffer: async () => value,
  };
}
