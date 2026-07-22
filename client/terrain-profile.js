import { PROJECTION } from "./projection.js";
import { TERRAIN_MATERIALS } from "./terrain-materials.js";

export function terrainProfile(map) {
  const profile = map.terrain ?? defaultTerrainProfile();
  if (
    profile.profile !== "duskfell-terrain-v1" ||
    profile.unitsPerTile !== PROJECTION.unitsPerTile ||
    profile.tileWidth !== PROJECTION.tileW ||
    profile.tileHeight !== PROJECTION.tileH ||
    profile.heightScale !== PROJECTION.zPx
  ) {
    throw new Error("terrain profile does not match the client projection");
  }
  return profile;
}

export function defaultTerrainProfile() {
  return {
    profile: "duskfell-terrain-v1",
    seed: 7341,
    visualDetailEnabled: true,
    detailAuthorityEnabled: true,
    unitsPerTile: PROJECTION.unitsPerTile,
    tileWidth: PROJECTION.tileW,
    tileHeight: PROJECTION.tileH,
    heightScale: PROJECTION.zPx,
    minElevation: -1,
    maxElevation: 4,
    waterLevel: -1,
    maxWalkableStep: 1,
    materials: Object.keys(TERRAIN_MATERIALS),
  };
}
