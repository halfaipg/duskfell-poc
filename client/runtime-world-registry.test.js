import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { loadApprovedRuntimeWorld, normalizeRuntimeWorldManifest, normalizeRuntimeWorldRegistry } from "./runtime-world-registry.js";

const hash = "a".repeat(64);

test("runtime world registry rejects duplicate ids, unsafe paths, and hash drift", () => {
  const registry = { schemaVersion: "duskfell-runtime-world-registry-v1", projection: "military-plan-oblique", worlds: [
    { id: "ash-valley", directory: "ash-valley", manifest: "runtime-manifest.json", manifestSha256: hash },
  ] };
  assert.equal(normalizeRuntimeWorldRegistry(registry).worlds[0].id, "ash-valley");
  assert.throws(() => normalizeRuntimeWorldRegistry({ ...registry, worlds: [...registry.worlds, registry.worlds[0]] }), /duplicate/);
  assert.throws(() => normalizeRuntimeWorldRegistry({ ...registry, worlds: [{ ...registry.worlds[0], directory: "../ash-valley" }] }), /unsafe path/);
  assert.throws(() => normalizeRuntimeWorldRegistry({ ...registry, worlds: [{ ...registry.worlds[0], manifestSha256: "nope" }] }), /manifest hash/);
  assert.throws(() => normalizeRuntimeWorldRegistry({ ...registry, worlds: [{ ...registry.worlds[0], state: "pending" }] }), /state/);
});

test("runtime world manifest requires approved military projection and pinned rasters", () => {
  const manifest = fixtureManifest();
  assert.equal(normalizeRuntimeWorldManifest(manifest, "ash-valley").rasters.gameplay.width, 512);
  assert.throws(() => normalizeRuntimeWorldManifest({ ...manifest, state: "review" }, "ash-valley"), /not approved/);
  assert.equal(normalizeRuntimeWorldManifest({
    ...manifest,
    state: "review",
    approval: undefined,
    review: { path: "review-staging.json", sha256: hash, humanApproval: false },
  }, "ash-valley", "review").state, "review");
  assert.throws(() => normalizeRuntimeWorldManifest({ ...manifest, projection: "isometric" }, "ash-valley"), /projection/);
  assert.throws(() => normalizeRuntimeWorldManifest({ ...manifest, rasters: { ...manifest.rasters, gameplay: { ...manifest.rasters.gameplay, path: "../world.png" } } }, "ash-valley"), /path/);
  const chunked = normalizeRuntimeWorldManifest({ ...manifest, chunks: { index: { path: "chunks/index.json", sha256: hash }, count: 24, chunkTiles: 32, apronTiles: 4 } }, "ash-valley");
  assert.equal(chunked.chunks.count, 24);
  assert.throws(() => normalizeRuntimeWorldManifest({ ...manifest, chunks: { index: { path: "../index.json", sha256: hash }, count: 1, chunkTiles: 32, apronTiles: 4 } }, "ash-valley"), /chunk index/);
  const withVisuals = normalizeRuntimeWorldManifest({
    ...manifest,
    chunkVisuals: { illustrated: visualReference(hash) },
  }, "ash-valley");
  assert.equal(withVisuals.chunkVisuals.illustrated.count, 1);
  assert.throws(() => normalizeRuntimeWorldManifest({
    ...manifest,
    chunkVisuals: { illustrated: { ...visualReference(hash), index: { path: "../index.json", sha256: hash } } },
  }, "ash-valley"), /visual illustrated index/);
});

test("approved chunked world loader skips its monolith and verifies indexed chunks", async () => {
  const bundle = { schema: "duskfell-world-bundle-v2", id: "ash-valley", dimensions: { cols: 16, rows: 16, unitsPerTile: 64 } };
  const bundleBytes = bytes(bundle);
  const core = { x: 0, y: 0, cols: 16, rows: 16 };
  const sample = { x: 0, y: 0, cols: 16, rows: 16 };
  const chunkBytes = bytes({ schema: "duskfell-world-chunk-v1", world: "ash-valley", id: "0-0", coord: { x: 0, y: 0 }, core, sample });
  const chunkIndex = {
    schema: "duskfell-world-chunk-index-v1",
    world: "ash-valley",
    sourceBundleContentSha256: "b".repeat(64),
    dimensions: { cols: 16, rows: 16, unitsPerTile: 64, width: 1024, height: 1024 },
    chunkTiles: 16,
    apronTiles: 4,
    grid: { cols: 1, rows: 1 },
    chunks: [{ id: "0-0", coord: { x: 0, y: 0 }, core, sample, path: "chunks/chunk-0-0.json", sha256: digest(chunkBytes), bytes: chunkBytes.byteLength }],
  };
  const chunkIndexBytes = bytes(chunkIndex);
  const visualBytes = new Uint8Array(96).buffer;
  const visualIndex = {
    schema: "duskfell-chunk-visual-illustrated-index-v1",
    role: "illustrated",
    world: "ash-valley",
    sourceBundleContentSha256: chunkIndex.sourceBundleContentSha256,
    sourceChunkIndexSha256: digest(chunkIndexBytes),
    sourceRaster: { path: "illustrated-gameplay.png", sha256: hash, width: 512, height: 512, pixelsPerTile: 32 },
    chunkTiles: 16,
    apronTiles: 4,
    grid: { cols: 1, rows: 1 },
    entries: [{
      id: "0-0",
      coord: { x: 0, y: 0 },
      core,
      sample,
      image: {
        path: "chunks/visual-illustrated/chunk-0-0.png",
        width: 512,
        height: 512,
        pixelsPerTile: 32,
        sha256: digest(visualBytes),
        bytes: visualBytes.byteLength,
      },
      coreCrop: { x: 0, y: 0, width: 512, height: 512 },
    }],
    seams: [],
  };
  const visualIndexBytes = bytes(visualIndex);
  const manifest = fixtureManifest({
    bundleSha256: digest(bundleBytes),
    chunks: { index: { path: "chunks/index.json", sha256: digest(chunkIndexBytes) }, count: 1, chunkTiles: 16, apronTiles: 4 },
    chunkVisuals: { illustrated: visualReference(digest(visualIndexBytes), visualBytes.byteLength) },
  });
  const manifestBytes = bytes(manifest);
  const registry = { schemaVersion: "duskfell-runtime-world-registry-v1", projection: "military-plan-oblique", worlds: [
    { id: "ash-valley", directory: "ash-valley", manifest: "runtime-manifest.json", manifestSha256: digest(manifestBytes) },
  ] };
  const responses = new Map([
    ["/assets/terrain/worlds/registry.json", jsonResponse(registry)],
    ["/assets/terrain/worlds/ash-valley/runtime-manifest.json", binaryResponse(manifestBytes)],
    ["/assets/terrain/worlds/ash-valley/world-bundle-v2.json", binaryResponse(bundleBytes)],
    ["/assets/terrain/worlds/ash-valley/chunks/index.json", binaryResponse(chunkIndexBytes)],
    ["/assets/terrain/worlds/ash-valley/chunks/chunk-0-0.json", binaryResponse(chunkBytes)],
    ["/assets/terrain/worlds/ash-valley/chunks/visual-illustrated/index.json", binaryResponse(visualIndexBytes)],
    ["/assets/terrain/worlds/ash-valley/chunks/visual-illustrated/chunk-0-0.png", binaryResponse(visualBytes)],
  ]);
  const loadedImages = [];
  const loaded = await loadApprovedRuntimeWorld("ash-valley", {
    fetchImpl: async (url) => responses.get(url) ?? { ok: false, status: 404 },
    imageLoader: async (url, sha256) => { loadedImages.push({ url, sha256 }); return { url }; },
    decodeVisualImage: async () => ({ width: 512, height: 512 }),
  });
  assert.equal(loaded.bundle, null);
  assert.deepEqual(loaded.dimensions, chunkIndex.dimensions);
  assert.equal(responses.get("/assets/terrain/worlds/ash-valley/world-bundle-v2.json").requests, 0);
  assert.equal((await loaded.chunkStream.loadChunk(0, 0)).id, "0-0");
  assert.equal((await loaded.visualChunkStream.loadChunk(0, 0)).entry.id, "0-0");
  assert.equal(loaded.gameplayImage, null);
  assert.equal(loadedImages.length, 1);
  assert.equal(await loadApprovedRuntimeWorld("unknown", { fetchImpl: async () => jsonResponse(registry) }), null);
});

test("approved legacy world loader retains the verified monolithic fallback", async () => {
  const bundle = { schema: "duskfell-world-bundle-v2", id: "ash-valley", dimensions: { cols: 16, rows: 16, unitsPerTile: 64, width: 1024, height: 1024 } };
  const bundleBytes = bytes(bundle);
  const manifest = fixtureManifest({ bundleSha256: digest(bundleBytes) });
  const manifestBytes = bytes(manifest);
  const registry = { schemaVersion: "duskfell-runtime-world-registry-v1", projection: "military-plan-oblique", worlds: [
    { id: "ash-valley", directory: "ash-valley", manifest: "runtime-manifest.json", manifestSha256: digest(manifestBytes) },
  ] };
  const bundleResponse = binaryResponse(bundleBytes);
  const responses = new Map([
    ["/assets/terrain/worlds/registry.json", jsonResponse(registry)],
    ["/assets/terrain/worlds/ash-valley/runtime-manifest.json", binaryResponse(manifestBytes)],
    ["/assets/terrain/worlds/ash-valley/world-bundle-v2.json", bundleResponse],
  ]);
  const loaded = await loadApprovedRuntimeWorld("ash-valley", {
    fetchImpl: async (url) => responses.get(url) ?? { ok: false, status: 404 },
    imageLoader: async (url) => ({ url }),
  });
  assert.equal(loaded.bundle.id, "ash-valley");
  assert.deepEqual(loaded.dimensions, bundle.dimensions);
  assert.equal(bundleResponse.requests, 1);
  assert.equal(loaded.chunkStream, null);
});

test("review world loader requires an explicit local preview opt-in", async () => {
  const bundle = { schema: "duskfell-world-bundle-v2", id: "ash-valley", dimensions: { cols: 16, rows: 16, unitsPerTile: 64, width: 1024, height: 1024 } };
  const bundleBytes = bytes(bundle);
  const manifest = {
    ...fixtureManifest({ bundleSha256: digest(bundleBytes) }),
    state: "review",
    approval: undefined,
    review: { path: "review-staging.json", sha256: hash, humanApproval: false },
  };
  const manifestBytes = bytes(manifest);
  const registry = { schemaVersion: "duskfell-runtime-world-registry-v1", projection: "military-plan-oblique", worlds: [
    { id: "ash-valley", directory: "ash-valley", manifest: "runtime-manifest.json", manifestSha256: digest(manifestBytes), state: "review" },
  ] };
  const responses = new Map([
    ["/assets/terrain/worlds/registry.json", jsonResponse(registry)],
    ["/assets/terrain/worlds/ash-valley/runtime-manifest.json", binaryResponse(manifestBytes)],
    ["/assets/terrain/worlds/ash-valley/world-bundle-v2.json", binaryResponse(bundleBytes)],
  ]);
  const fetchImpl = async (url) => responses.get(url) ?? { ok: false, status: 404 };
  assert.equal(await loadApprovedRuntimeWorld("ash-valley", { fetchImpl }), null);
  const loaded = await loadApprovedRuntimeWorld("ash-valley", {
    fetchImpl,
    allowReview: true,
    imageLoader: async (url) => ({ url }),
  });
  assert.equal(loaded.manifest.state, "review");
  assert.equal(loaded.bundle.id, "ash-valley");
});

function fixtureManifest({ bundleSha256 = hash, chunks = null, chunkVisuals = null } = {}) {
  const raster = (path, pixelsPerTile) => ({ path, sha256: hash, width: 16 * pixelsPerTile, height: 16 * pixelsPerTile, pixelsPerTile });
  return {
    schemaVersion: "duskfell-runtime-world-v1",
    state: "approved",
    world: "ash-valley",
    projection: "military-plan-oblique",
    sourcePackage: { manifest: "manifest.json", sha256: hash },
    approval: { path: "visual-approval.json", sha256: hash, approver: "test", reviewedAt: "2026-07-20T12:00:00.000Z" },
    bundle: { path: "world-bundle-v2.json", sha256: bundleSha256 },
    rasters: {
      gameplay: raster("illustrated-gameplay.png", 32),
      travel: raster("illustrated-travel.png", 16),
      worldMap: raster("illustrated-world-map.png", 8),
    },
    chunks,
    chunkVisuals,
  };
}

function visualReference(indexSha256, totalBytes = 96) {
  return {
    index: { path: "chunks/visual-illustrated/index.json", sha256: indexSha256 },
    count: 1,
    seamCount: 0,
    pixelsPerTile: 32,
    totalBytes,
  };
}

function bytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).buffer;
}

function digest(value) {
  return crypto.createHash("sha256").update(Buffer.from(value)).digest("hex");
}

function jsonResponse(value) {
  return { ok: true, json: async () => value };
}

function binaryResponse(value) {
  return {
    requests: 0,
    ok: true,
    arrayBuffer: async function () {
      this.requests += 1;
      return value;
    },
  };
}
