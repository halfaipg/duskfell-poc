import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { normalizeWorldChunkIndex, openWorldChunkStream, WorldChunkStream } from "./world-chunk-stream.js";

test("chunk index normalization rejects unsafe paths and geometry drift", () => {
  const fixture = makeFixture(2, 2);
  const normalized = normalizeWorldChunkIndex(fixture.index, fixture.world);
  assert.equal(normalized.entries.size, 4);
  const unsafe = structuredClone(fixture.index);
  unsafe.chunks[0].path = "../chunk.json";
  assert.throws(() => normalizeWorldChunkIndex(unsafe, fixture.world), /identity/);
  const drifted = structuredClone(fixture.index);
  drifted.chunks[0].core.x += 1;
  assert.throws(() => normalizeWorldChunkIndex(drifted, fixture.world), /core/);
});

test("chunk stream verifies bytes, deduplicates requests, and evicts by bounded LRU", async () => {
  const fixture = makeFixture(4, 3);
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    const bytes = fixture.responses.get(url);
    return bytes ? binaryResponse(bytes) : { ok: false, status: 404 };
  };
  const stream = new WorldChunkStream({
    root: fixture.root,
    index: normalizeWorldChunkIndex(fixture.index, fixture.world),
    fetchImpl,
    maxCachedChunks: 9,
  });
  const [first, duplicate] = await Promise.all([stream.loadChunk(0, 0), stream.loadChunk(0, 0)]);
  assert.equal(first, duplicate);
  assert.equal(requests.filter((url) => url.endsWith("chunk-0-0.json")).length, 1);
  for (const entry of fixture.index.chunks) await stream.loadChunk(entry.coord.x, entry.coord.y);
  assert.equal(stream.snapshot().cached, 9);
  assert.ok(stream.snapshot().evictions >= 3);
  assert.equal(stream.getChunkAtTile(31, 23)?.id, "3-2");
  assert.equal(stream.getChunkAtTile(0, 0), null);
});

test("opening and prefetching a chunk stream verifies the pinned index", async () => {
  const fixture = makeFixture(3, 3);
  const indexBytes = bytes(fixture.index);
  fixture.responses.set(`${fixture.root}/chunks/index.json`, indexBytes);
  const fetchImpl = async (url) => fixture.responses.has(url) ? binaryResponse(fixture.responses.get(url)) : { ok: false, status: 404 };
  const stream = await openWorldChunkStream({
    root: fixture.root,
    world: fixture.world,
    indexReference: { path: "chunks/index.json", sha256: digest(indexBytes) },
    fetchImpl,
    maxCachedChunks: 9,
  });
  const loaded = await stream.prefetchAhead({ tileX: 8, tileY: 8, velocityX: 1, velocityY: 0 });
  assert.ok(loaded.size >= 4 && loaded.size <= 9);
  const corrupt = new Uint8Array(indexBytes.slice(0));
  corrupt[0] ^= 1;
  fixture.responses.set(`${fixture.root}/chunks/index.json`, corrupt.buffer);
  await assert.rejects(() => openWorldChunkStream({
    root: fixture.root,
    world: fixture.world,
    indexReference: { path: "chunks/index.json", sha256: digest(indexBytes) },
    fetchImpl,
  }), /SHA-256 mismatch/);
});

function makeFixture(gridCols, gridRows) {
  const world = "chunk-proof";
  const root = "/worlds/chunk-proof";
  const chunkTiles = 8;
  const apronTiles = 2;
  const cols = gridCols * chunkTiles;
  const rows = gridRows * chunkTiles;
  const responses = new Map();
  const chunks = [];
  for (let y = 0; y < gridRows; y += 1) for (let x = 0; x < gridCols; x += 1) {
    const core = { x: x * chunkTiles, y: y * chunkTiles, cols: chunkTiles, rows: chunkTiles };
    const sample = {
      x: Math.max(0, core.x - apronTiles),
      y: Math.max(0, core.y - apronTiles),
      cols: Math.min(cols, core.x + core.cols + apronTiles) - Math.max(0, core.x - apronTiles),
      rows: Math.min(rows, core.y + core.rows + apronTiles) - Math.max(0, core.y - apronTiles),
    };
    const id = `${x}-${y}`;
    const path = `chunks/chunk-${x}-${y}.json`;
    const chunkBytes = bytes({ schema: "duskfell-world-chunk-v1", world, id, coord: { x, y }, core, sample });
    responses.set(`${root}/${path}`, chunkBytes);
    chunks.push({ id, coord: { x, y }, core, sample, path, sha256: digest(chunkBytes), bytes: chunkBytes.byteLength });
  }
  return {
    world,
    root,
    responses,
    index: {
      schema: "duskfell-world-chunk-index-v1",
      world,
      sourceBundleContentSha256: "a".repeat(64),
      dimensions: { cols, rows, unitsPerTile: 64, width: cols * 64, height: rows * 64 },
      chunkTiles,
      apronTiles,
      grid: { cols: gridCols, rows: gridRows },
      fields: [],
      biomeWeights: [],
      chunks,
    },
  };
}

function bytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).buffer;
}

function digest(value) {
  return crypto.createHash("sha256").update(Buffer.from(value)).digest("hex");
}

function binaryResponse(value) {
  return { ok: true, arrayBuffer: async () => value };
}
