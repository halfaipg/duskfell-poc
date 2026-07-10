import { clamp, noise2d } from "./terrain-noise.js";
import { streamCenterAt } from "./terrain-biome.js";

export function cornerHeights(x, y, cols, rows, safeRadiusTiles, material, profile) {
  if (material === "water") {
    return {
      nw: profile.waterLevel,
      ne: profile.waterLevel,
      se: profile.waterLevel,
      sw: profile.waterLevel,
    };
  }
  const heights = {
    nw: vertexHeight(x, y, cols, rows, safeRadiusTiles, profile),
    ne: vertexHeight(x + 1, y, cols, rows, safeRadiusTiles, profile),
    se: vertexHeight(x + 1, y + 1, cols, rows, safeRadiusTiles, profile),
    sw: vertexHeight(x, y + 1, cols, rows, safeRadiusTiles, profile),
  };

  if (material === "settlement") {
    return Object.fromEntries(Object.entries(heights).map(([key, value]) => [key, clamp(value, 0, 1)]));
  }
  return heights;
}

export function terrainHeightMetadata(heights) {
  const values = [heights.nw, heights.ne, heights.se, heights.sw];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const north = (heights.nw + heights.ne) / 2;
  const south = (heights.sw + heights.se) / 2;
  const west = (heights.nw + heights.sw) / 2;
  const east = (heights.ne + heights.se) / 2;
  const slopeX = east - west;
  const slopeY = south - north;
  const normal = normalizeNormal({
    x: -slopeX,
    y: -slopeY,
    z: 2,
  });
  const sun = normalizeNormal({
    x: -0.48,
    y: -0.66,
    z: 0.58,
  });
  const light = clamp(0.58 + dot(normal, sun) * 0.32, 0.28, 0.9);
  return {
    min,
    max,
    average,
    range: max - min,
    north,
    south,
    east,
    west,
    slopeX,
    slopeY,
    normal,
    light,
  };
}

// Designed geography instead of high-frequency chop: the heath highland
// climbs across the northeast along the same field that splits the visual
// biomes (so the dark heath sits ON the high ground), meadow rolls gently,
// and the stream carves a dale — a gorge where it cuts the highland.
// Wavelengths are long so contour steps stay 1 tile apart (walkable,
// maxWalkableStep 1) except on the steepest highland scarps.
export function vertexHeight(x, y, cols, rows, safeRadiusTiles, profile) {
  const centerDistance = Math.hypot(x - cols / 2, y - rows / 2);
  if (centerDistance < safeRadiusTiles * 0.58) return 0;

  const nx = x / cols;
  const ny = y / rows;
  const highlandField =
    (nx - 0.62) * 1.1 +
    (0.42 - ny) * 1.35 +
    noise2d(x * 0.05, y * 0.05, profile.seed + 41) * 0.18;
  const highland = smooth01((highlandField + 0.05) / 0.7) * 4.6;
  const rolling =
    noise2d(x * 0.05, y * 0.05, profile.seed + 11) * 1.4 +
    noise2d(x * 0.11, y * 0.11, profile.seed + 23) * 0.6;
  const dale =
    -smooth01((6.5 - Math.abs(x - streamCenterAt(y, cols, rows, profile))) / 6.5) * 2.2;
  const settleBlend = smooth01(
    (centerDistance - safeRadiusTiles * 0.58) / Math.max(0.001, safeRadiusTiles * 0.55),
  );
  const height = (highland + rolling + dale) * settleBlend;
  return clamp(Math.round(height), profile.minElevation, profile.maxElevation);
}

function smooth01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function normalizeNormal(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function dot(first, second) {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}
