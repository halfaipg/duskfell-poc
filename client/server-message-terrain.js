import { TERRAIN_MATERIALS, TERRAIN_PROFILE } from "./server-message-constants.js";
import {
  isObject,
  normalizeArray,
  normalizeInteger,
  normalizeNonNegativeInteger,
  normalizeNonNegativeNumber,
  normalizePositiveInteger,
  normalizePositiveNumber,
} from "./server-message-validators.js";

export function normalizeMap(map, prefix) {
  if (!isObject(map)) {
    throw new Error(`${prefix} must be an object`);
  }
  return {
    width: normalizePositiveNumber(map.width, `${prefix}.width`),
    height: normalizePositiveNumber(map.height, `${prefix}.height`),
    safeZoneRadius: normalizeNonNegativeNumber(map.safeZoneRadius, `${prefix}.safeZoneRadius`),
    terrain: normalizeTerrain(map.terrain, `${prefix}.terrain`),
  };
}

function normalizeTerrain(terrain, prefix) {
  if (!isObject(terrain)) {
    throw new Error(`${prefix} must be an object`);
  }
  if (terrain.profile !== TERRAIN_PROFILE) {
    throw new Error(`${prefix}.profile is not supported`);
  }
  const unitsPerTile = normalizePositiveInteger(terrain.unitsPerTile, `${prefix}.unitsPerTile`);
  const tileWidth = normalizePositiveInteger(terrain.tileWidth, `${prefix}.tileWidth`);
  const tileHeight = normalizePositiveInteger(terrain.tileHeight, `${prefix}.tileHeight`);
  if (unitsPerTile !== 64 || tileWidth !== 64 || tileHeight !== 64) {
    throw new Error(`${prefix} projection does not match the client`);
  }
  const heightScale = normalizePositiveNumber(terrain.heightScale, `${prefix}.heightScale`);
  if (heightScale !== 6) {
    throw new Error(`${prefix}.heightScale does not match the client`);
  }
  const minElevation = normalizeInteger(terrain.minElevation, `${prefix}.minElevation`);
  const maxElevation = normalizeInteger(terrain.maxElevation, `${prefix}.maxElevation`);
  const waterLevel = normalizeInteger(terrain.waterLevel, `${prefix}.waterLevel`);
  if (minElevation > maxElevation) {
    throw new Error(`${prefix}.minElevation must be <= maxElevation`);
  }
  if (waterLevel < minElevation || waterLevel > maxElevation) {
    throw new Error(`${prefix}.waterLevel must be inside the elevation range`);
  }
  const materials = normalizeArray(terrain.materials, `${prefix}.materials`, TERRAIN_MATERIALS.size);
  if (materials.length !== TERRAIN_MATERIALS.size) {
    throw new Error(`${prefix}.materials must declare the canonical material set`);
  }
  const materialSet = new Set();
  for (const material of materials) {
    if (!TERRAIN_MATERIALS.has(material)) {
      throw new Error(`${prefix}.materials contains unsupported material ${material}`);
    }
    if (materialSet.has(material)) {
      throw new Error(`${prefix}.materials contains duplicate material ${material}`);
    }
    materialSet.add(material);
  }

  return {
    profile: terrain.profile,
    seed: normalizeNonNegativeInteger(terrain.seed, `${prefix}.seed`),
    unitsPerTile,
    tileWidth,
    tileHeight,
    heightScale,
    minElevation,
    maxElevation,
    waterLevel,
    maxWalkableStep: normalizePositiveInteger(terrain.maxWalkableStep, `${prefix}.maxWalkableStep`),
    materials,
  };
}
