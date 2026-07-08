import { buildTerrain } from "./terrain.js";

export function createTerrainCache() {
  let terrain = null;
  let terrainCacheKey = "";

  return {
    terrainForMap(map) {
      const key = terrainKey(map);
      if (terrainCacheKey !== key) {
        terrain = buildTerrain(map);
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
