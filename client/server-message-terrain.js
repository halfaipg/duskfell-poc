import { PROJECTION } from "./projection.js";
import { TERRAIN_MATERIALS, TERRAIN_PROFILE } from "./server-message-constants.js";
import { MAX_TRAILS, MAX_TRAIL_POINTS } from "./terrain-trails.js";
import {
  isObject,
  normalizeArray,
  normalizeBoolean,
  normalizeFiniteNumber,
  normalizeInteger,
  normalizeNonNegativeInteger,
  normalizeNonNegativeNumber,
  normalizePositiveInteger,
  normalizePositiveNumber,
  normalizeText,
} from "./server-message-validators.js";

const TRAIL_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

export function normalizeMap(map, prefix) {
  if (!isObject(map)) {
    throw new Error(`${prefix} must be an object`);
  }
  const width = normalizePositiveNumber(map.width, `${prefix}.width`);
  const height = normalizePositiveNumber(map.height, `${prefix}.height`);
  const terrain = normalizeTerrain(map.terrain, `${prefix}.terrain`, width, height);
  return {
    width,
    height,
    safeZoneRadius: normalizeNonNegativeNumber(map.safeZoneRadius, `${prefix}.safeZoneRadius`),
    region: normalizeRegionRouting(map.region, `${prefix}.region`, width, height, terrain.unitsPerTile),
    terrain,
  };
}

function normalizeRegionRouting(value, prefix, width, height, unitsPerTile) {
  if (value == null) return null;
  if (!isObject(value)) throw new Error(`${prefix} must be an object`);
  if (value.schemaVersion !== "duskfell-region-routing-v1") throw new Error(`${prefix}.schemaVersion is unsupported`);
  const atlasId = normalizeText(value.atlasId, `${prefix}.atlasId`);
  if (atlasId.length > 80 || !TRAIL_ID_RE.test(atlasId)) throw new Error(`${prefix}.atlasId must be bounded lowercase kebab-case`);
  const atlasContentSha256 = normalizeText(value.atlasContentSha256, `${prefix}.atlasContentSha256`);
  if (!SHA256_RE.test(atlasContentSha256)) throw new Error(`${prefix}.atlasContentSha256 must be lowercase SHA-256`);
  const coord = normalizeRegionCoord(value.coord, `${prefix}.coord`);
  const tileOrigin = normalizeRegionCoord(value.tileOrigin, `${prefix}.tileOrigin`);
  const regionId = normalizeText(value.regionId, `${prefix}.regionId`);
  const expectedRegionId = `${atlasId}-r${coord.x}-${coord.y}`;
  if (regionId !== expectedRegionId) throw new Error(`${prefix}.regionId does not match atlas coordinate`);
  const cols = Math.ceil(width / unitsPerTile);
  const rows = Math.ceil(height / unitsPerTile);
  if (tileOrigin.x !== coord.x * cols || tileOrigin.y !== coord.y * rows) throw new Error(`${prefix}.tileOrigin does not match regional grid`);
  if (!isObject(value.neighbors)) throw new Error(`${prefix}.neighbors must be an object`);
  const neighbor = (direction, x, y, required) => {
    const raw = value.neighbors[direction];
    if (raw == null) {
      if (required) throw new Error(`${prefix}.neighbors.${direction} is missing`);
      return null;
    }
    const id = normalizeText(raw, `${prefix}.neighbors.${direction}`);
    if (id !== `${atlasId}-r${x}-${y}`) throw new Error(`${prefix}.neighbors.${direction} does not match atlas coordinate`);
    return id;
  };
  return {
    schemaVersion: value.schemaVersion,
    atlasId,
    atlasContentSha256,
    regionId,
    coord,
    tileOrigin,
    neighbors: {
      north: neighbor("north", coord.x, Math.max(0, coord.y - 1), coord.y > 0),
      east: neighbor("east", coord.x + 1, coord.y, false),
      south: neighbor("south", coord.x, coord.y + 1, false),
      west: neighbor("west", Math.max(0, coord.x - 1), coord.y, coord.x > 0),
    },
  };
}

function normalizeRegionCoord(value, prefix) {
  if (!isObject(value)) throw new Error(`${prefix} must be an object`);
  return {
    x: normalizeNonNegativeInteger(value.x, `${prefix}.x`),
    y: normalizeNonNegativeInteger(value.y, `${prefix}.y`),
  };
}

function normalizeTerrain(terrain, prefix, mapWidth, mapHeight) {
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
  if (heightScale !== PROJECTION.zPx) {
    throw new Error(`${prefix}.heightScale does not match the client`);
  }
  const minElevation = normalizeInteger(terrain.minElevation, `${prefix}.minElevation`);
  const maxElevation = normalizeInteger(terrain.maxElevation, `${prefix}.maxElevation`);
  const waterLevel = normalizeInteger(terrain.waterLevel, `${prefix}.waterLevel`);
  const vertexHeightPrecision = normalizePositiveInteger(
    terrain.vertexHeightPrecision ?? 1,
    `${prefix}.vertexHeightPrecision`,
  );
  if (vertexHeightPrecision > 100_000) {
    throw new Error(`${prefix}.vertexHeightPrecision exceeds maximum value`);
  }
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
  const trails = normalizeTrails(
    terrain.trails ?? [],
    `${prefix}.trails`,
    Math.ceil(mapWidth / unitsPerTile),
    Math.ceil(mapHeight / unitsPerTile),
  );

  return {
    profile: terrain.profile,
    seed: normalizeNonNegativeInteger(terrain.seed, `${prefix}.seed`),
    detailAuthorityEnabled: normalizeBoolean(
      terrain.detailAuthorityEnabled,
      `${prefix}.detailAuthorityEnabled`,
    ),
    visualDetailEnabled: terrain.visualDetailEnabled == null
      ? true
      : normalizeBoolean(terrain.visualDetailEnabled, `${prefix}.visualDetailEnabled`),
    unitsPerTile,
    tileWidth,
    tileHeight,
    heightScale,
    minElevation,
    maxElevation,
    waterLevel,
    maxWalkableStep: normalizePositiveInteger(terrain.maxWalkableStep, `${prefix}.maxWalkableStep`),
    vertexHeightPrecision,
    materials,
    trails,
  };
}

function normalizeTrails(value, prefix, cols, rows) {
  const trails = normalizeArray(value, prefix, MAX_TRAILS);
  const ids = new Set();
  return trails.map((trail, index) => {
    const itemPrefix = `${prefix}[${index}]`;
    if (!isObject(trail)) throw new Error(`${itemPrefix} must be an object`);
    const id = normalizeText(trail.id, `${itemPrefix}.id`);
    if (id.length > 40 || !TRAIL_ID_RE.test(id)) {
      throw new Error(`${itemPrefix}.id must be lowercase kebab-case`);
    }
    if (ids.has(id)) throw new Error(`${prefix} contains duplicate id ${id}`);
    ids.add(id);
    const label = normalizeText(trail.label, `${itemPrefix}.label`);
    if (label.length > 40) throw new Error(`${itemPrefix}.label exceeds maximum length`);
    if (trail.kind !== "road" && trail.kind !== "trail") {
      throw new Error(`${itemPrefix}.kind is not supported`);
    }
    const widthTiles = normalizePositiveNumber(trail.widthTiles, `${itemPrefix}.widthTiles`);
    if (widthTiles < 0.4 || widthTiles > 3) {
      throw new Error(`${itemPrefix}.widthTiles must be between 0.4 and 3`);
    }
    const points = normalizeArray(trail.points, `${itemPrefix}.points`, MAX_TRAIL_POINTS);
    if (points.length < 2) throw new Error(`${itemPrefix}.points must contain at least two points`);
    return {
      id,
      label,
      kind: trail.kind,
      widthTiles,
      points: points.map((point, pointIndex) => {
        const pointPrefix = `${itemPrefix}.points[${pointIndex}]`;
        if (!isObject(point)) throw new Error(`${pointPrefix} must be an object`);
        const x = normalizeFiniteNumber(point.x, `${pointPrefix}.x`);
        const y = normalizeFiniteNumber(point.y, `${pointPrefix}.y`);
        if (x < 0 || x > cols || y < 0 || y > rows) {
          throw new Error(`${pointPrefix} must be inside terrain bounds`);
        }
        return { x, y };
      }),
    };
  });
}
