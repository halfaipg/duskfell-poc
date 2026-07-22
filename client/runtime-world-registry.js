import { verifySha256Bytes } from "./asset-integrity.js";
import { loadVerifiedPngImage } from "./runtime-image-loader.js";
import { openWorldChunkStream } from "./world-chunk-stream.js";
import { openWorldVisualChunkStream } from "./world-visual-chunk-stream.js";
import { GRAPHICS_BUDGET } from "./device-profile.js";

const WORLD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function normalizeRuntimeWorldRegistry(value) {
  if (value?.schemaVersion !== "duskfell-runtime-world-registry-v1") throw new Error("runtime world registry schema is invalid");
  if (value?.projection !== "military-plan-oblique") throw new Error("runtime world registry projection is invalid");
  if (!Array.isArray(value.worlds) || value.worlds.length > 64) throw new Error("runtime world registry worlds must be a bounded array");
  const ids = new Set();
  const worlds = value.worlds.map((entry, index) => {
    if (!WORLD_ID.test(entry?.id ?? "") || ids.has(entry.id)) throw new Error(`runtime world registry entry ${index} has an invalid or duplicate id`);
    ids.add(entry.id);
    if (entry.directory !== entry.id || entry.manifest !== "runtime-manifest.json") throw new Error(`runtime world registry entry ${entry.id} has an unsafe path`);
    if (!SHA256.test(entry.manifestSha256 ?? "")) throw new Error(`runtime world registry entry ${entry.id} has an invalid manifest hash`);
    const state = entry.state ?? "approved";
    if (!["approved", "review"].includes(state)) throw new Error(`runtime world registry entry ${entry.id} has an invalid state`);
    return { id: entry.id, directory: entry.directory, manifest: entry.manifest, manifestSha256: entry.manifestSha256, state };
  });
  return { schemaVersion: value.schemaVersion, projection: value.projection, worlds };
}

export function normalizeRuntimeWorldManifest(value, expectedWorld, expectedState = "approved") {
  if (value?.schemaVersion !== "duskfell-runtime-world-v1" || value?.state !== expectedState) throw new Error(`runtime world manifest is not ${expectedState}`);
  if (value?.world !== expectedWorld || !WORLD_ID.test(value.world)) throw new Error("runtime world manifest identity is invalid");
  if (value?.projection !== "military-plan-oblique") throw new Error("runtime world manifest projection is invalid");
  const bundle = normalizeReference(value.bundle, "world-bundle-v2.json", "runtime world bundle");
  const gameplay = normalizeRaster(value.rasters?.gameplay, "gameplay raster");
  const travel = normalizeRaster(value.rasters?.travel, "travel raster");
  const worldMap = normalizeRaster(value.rasters?.worldMap, "world-map raster");
  const chunks = value.chunks ? normalizeRuntimeChunkReference(value.chunks) : null;
  const chunkVisuals = value.chunkVisuals ? normalizeRuntimeChunkVisualReferences(value.chunkVisuals) : null;
  if (expectedState === "approved") {
    if (value.approval?.path !== "visual-approval.json" || !SHA256.test(value.approval?.sha256 ?? "")) throw new Error("runtime world approval reference is invalid");
  } else if (value.review?.path !== "review-staging.json" || !SHA256.test(value.review?.sha256 ?? "") || value.review?.humanApproval !== false) {
    throw new Error("runtime world review reference is invalid");
  }
  if (!SHA256.test(value.sourcePackage?.sha256 ?? "")) throw new Error("runtime world source package hash is invalid");
  return {
    schemaVersion: value.schemaVersion,
    state: value.state,
    world: value.world,
    projection: value.projection,
    bundle,
    rasters: { gameplay, travel, worldMap },
    chunks,
    chunkVisuals,
    approval: value.approval,
    validation: value.validation,
  };
}

export async function loadApprovedRuntimeWorld(worldId, options = {}) {
  if (!WORLD_ID.test(worldId ?? "")) return null;
  const fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const imageLoader = options.imageLoader ?? loadVerifiedPngImage;
  const registryResponse = await fetchImpl("/assets/terrain/worlds/registry.json", { cache: "no-store", headers: { accept: "application/json" } });
  if (!registryResponse.ok) return null;
  const registry = normalizeRuntimeWorldRegistry(await registryResponse.json());
  const entry = registry.worlds.find((candidate) => candidate.id === worldId);
  if (!entry) return null;
  if (entry.state === "review" && options.allowReview !== true) return null;
  const root = `/assets/terrain/worlds/${entry.directory}`;
  const manifest = normalizeRuntimeWorldManifest(
    await loadVerifiedJson(`${root}/${entry.manifest}`, entry.manifestSha256, fetchImpl),
    worldId,
    entry.state,
  );
  const illustratedChunks = manifest.chunkVisuals?.illustrated ?? null;
  const [gameplayImage, worldMapImage, chunkStream, visualChunkStream] = await Promise.all([
    illustratedChunks ? null : imageLoader(`${root}/${manifest.rasters.gameplay.path}`, manifest.rasters.gameplay.sha256),
    imageLoader(`${root}/${manifest.rasters.worldMap.path}`, manifest.rasters.worldMap.sha256),
    manifest.chunks ? openWorldChunkStream({
      root,
      indexReference: manifest.chunks.index,
      world: worldId,
      fetchImpl,
      maxCachedChunks: options.maxCachedChunks ?? GRAPHICS_BUDGET.visualChunkCacheEntries,
    }) : null,
    illustratedChunks ? openWorldVisualChunkStream({
      root,
      indexReference: illustratedChunks.index,
      world: worldId,
      fetchImpl,
      decodeImage: options.decodeVisualImage,
      maxCachedChunks: options.maxCachedVisualChunks ?? options.maxCachedChunks ?? GRAPHICS_BUDGET.visualChunkCacheEntries,
    }) : null,
  ]);
  const bundle = chunkStream
    ? null
    : await loadVerifiedJson(`${root}/${manifest.bundle.path}`, manifest.bundle.sha256, fetchImpl);
  if (bundle && (bundle.schema !== "duskfell-world-bundle-v2" || bundle.id !== worldId)) throw new Error("approved runtime world bundle identity is invalid");
  const dimensions = structuredClone(chunkStream?.index.dimensions ?? bundle?.dimensions);
  const { cols, rows } = dimensions ?? {};
  for (const raster of Object.values(manifest.rasters)) {
    if (raster.width !== cols * raster.pixelsPerTile || raster.height !== rows * raster.pixelsPerTile) throw new Error("approved runtime world raster dimensions drift from bundle authority");
  }
  if (visualChunkStream && chunkStream
    && visualChunkStream.index.sourceChunkIndexSha256 !== manifest.chunks.index.sha256) {
    throw new Error("approved runtime visual chunks drift from authority chunks");
  }
  return { root, manifest, dimensions, bundle, gameplayImage, worldMapImage, chunkStream, visualChunkStream };
}

async function loadVerifiedJson(url, expectedSha256, fetchImpl) {
  const response = await fetchImpl(url, { cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`runtime world JSON request failed with ${response.status}`);
  const bytes = await response.arrayBuffer();
  await verifySha256Bytes(bytes, expectedSha256);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(`runtime world JSON is malformed: ${error.message}`);
  }
}

function normalizeReference(value, expectedPath, label) {
  if (value?.path !== expectedPath || !SHA256.test(value?.sha256 ?? "")) throw new Error(`${label} reference is invalid`);
  return { path: value.path, sha256: value.sha256 };
}

function normalizeRaster(value, label) {
  if (typeof value?.path !== "string" || value.path !== value.path.split("/").at(-1) || !value.path.endsWith(".png")) throw new Error(`${label} path is invalid`);
  if (!SHA256.test(value?.sha256 ?? "")) throw new Error(`${label} hash is invalid`);
  if (!Number.isInteger(value.width) || value.width < 64 || !Number.isInteger(value.height) || value.height < 64) throw new Error(`${label} dimensions are invalid`);
  if (!Number.isInteger(value.pixelsPerTile) || value.pixelsPerTile < 1 || value.pixelsPerTile > 64) throw new Error(`${label} scale is invalid`);
  return { path: value.path, sha256: value.sha256, width: value.width, height: value.height, pixelsPerTile: value.pixelsPerTile };
}

function normalizeRuntimeChunkReference(value) {
  if (value?.index?.path !== "chunks/index.json" || !SHA256.test(value.index?.sha256 ?? "")) throw new Error("runtime world chunk index reference is invalid");
  if (!Number.isInteger(value.count) || value.count < 1 || value.count > 65_536) throw new Error("runtime world chunk count is invalid");
  if (!Number.isInteger(value.chunkTiles) || value.chunkTiles < 8 || value.chunkTiles > 128) throw new Error("runtime world chunk size is invalid");
  if (!Number.isInteger(value.apronTiles) || value.apronTiles < 1 || value.apronTiles > 32) throw new Error("runtime world chunk apron is invalid");
  return structuredClone(value);
}

function normalizeRuntimeChunkVisualReferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("runtime world chunk visuals are invalid");
  const result = {};
  for (const role of ["control", "illustrated"]) {
    const reference = value[role];
    if (!reference) continue;
    const directory = role === "control" ? "chunks/visual-controls" : "chunks/visual-illustrated";
    if (reference.index?.path !== `${directory}/index.json` || !SHA256.test(reference.index?.sha256 ?? "")) {
      throw new Error(`runtime world chunk visual ${role} index reference is invalid`);
    }
    if (!Number.isInteger(reference.count) || reference.count < 1 || reference.count > 65_536
      || !Number.isInteger(reference.seamCount) || reference.seamCount < 0
      || !Number.isInteger(reference.pixelsPerTile) || reference.pixelsPerTile < 1 || reference.pixelsPerTile > 64
      || !Number.isInteger(reference.totalBytes) || reference.totalBytes < 1) {
      throw new Error(`runtime world chunk visual ${role} metadata is invalid`);
    }
    result[role] = structuredClone(reference);
  }
  return Object.keys(result).length > 0 ? result : null;
}
