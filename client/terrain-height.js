import { clamp, noise2d } from "./terrain-noise.js";

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

export function vertexHeight(x, y, cols, rows, safeRadiusTiles, profile) {
  const centerDistance = Math.hypot(x - cols / 2, y - rows / 2);
  if (centerDistance < safeRadiusTiles * 0.58) return 0;

  const wave = Math.sin(x * 0.47) * 1.2 + Math.cos(y * 0.39) * 1.1 + Math.sin((x - y) * 0.24);
  const ridged = noise2d(x * 0.7, y * 0.7, profile.seed) * 1.7;
  return clamp(Math.round(wave + ridged), profile.minElevation, profile.maxElevation);
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
