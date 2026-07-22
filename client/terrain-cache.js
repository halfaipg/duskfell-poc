import { buildTerrain } from "./terrain.js";

export function createTerrainCache() {
  let terrain = null;
  let terrainCacheKey = "";

  return {
    terrainForMap(map, bundle = null) {
      const key = `${terrainKey(map)}:${bundleKey(bundle)}`;
      if (terrainCacheKey !== key) {
        terrain = buildTerrain(map, bundle);
        terrainCacheKey = key;
      }
      return terrain;
    },
    getTerrain() {
      return terrain;
    },
    getTerrainCacheKey() {
      return terrainCacheKey;
    },
  };
}

function bundleKey(bundle) {
  if (!bundle) return "formula";
  const dimensions = bundle.dimensions ?? { cols: bundle.cols ?? 0, rows: bundle.rows ?? 0 };
  const stream = bundle.streamingWindow;
  if (stream) {
    const region = bundle.sourceRegion ?? {};
    return [
      bundle.schema,
      stream.sourceBundleContentSha256,
      region.offsetX,
      region.offsetY,
      dimensions.cols,
      dimensions.rows,
      stream.chunkIds?.join(","),
    ].join(":");
  }
  return [
    bundle.schema ?? bundle.version,
    bundle.id ?? bundle.world ?? "anonymous",
    bundle.contentSha256 ?? bundle.sourceBundleContentSha256 ?? "unhashed",
    dimensions.cols,
    dimensions.rows,
  ].join(":");
}

function terrainKey(map) {
  const terrainProfile = map.terrain;
  return [
    map.width,
    map.height,
    map.safeZoneRadius,
    terrainProfile?.profile,
    terrainProfile?.seed,
    terrainProfile?.unitsPerTile,
    terrainProfile?.tileWidth,
    terrainProfile?.tileHeight,
    terrainProfile?.heightScale,
    terrainProfile?.minElevation,
    terrainProfile?.maxElevation,
    terrainProfile?.waterLevel,
    terrainProfile?.maxWalkableStep,
    terrainProfile?.materials?.join(","),
  ].join(":");
}
