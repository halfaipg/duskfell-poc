import { PROJECTION } from "./projection.js";

export function testMap() {
  return {
    width: 3328,
    height: 2176,
    safeZoneRadius: 360,
    terrain: testTerrain(),
  };
}

export function testTerrain() {
  return {
    profile: "duskfell-terrain-v1",
    seed: 7341,
    unitsPerTile: 64,
    tileWidth: 64,
    tileHeight: 64,
    heightScale: 14,
    minElevation: -1,
    maxElevation: 4,
    waterLevel: -1,
    maxWalkableStep: 1,
    materials: ["grass", "field", "dirt", "stone", "water", "settlement", "cobble", "rock", "ruin", "shore"],
  };
}

export function detailTile(detail) {
  return {
    x: Math.floor(detail.x / PROJECTION.unitsPerTile),
    y: Math.floor(detail.y / PROJECTION.unitsPerTile),
  };
}
