import { vertexHeight } from "./terrain-height.js";
import { clamp, noise2d } from "./terrain-noise.js";
import { defaultTerrainProfile } from "./terrain-profile.js";

export function materialForTile(x, y, cols, rows, safeRadiusTiles, profile = defaultTerrainProfile()) {
  return materialForBiome(biomeForTile(x, y, cols, rows, safeRadiusTiles, profile));
}

export function biomeForTile(x, y, cols, rows, safeRadiusTiles, profile = defaultTerrainProfile()) {
  const centerX = cols / 2;
  const centerY = rows / 2;
  const centerDistance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
  const settlementPressure = clamp(1 - centerDistance / Math.max(0.001, safeRadiusTiles * 0.58), 0, 1);
  const plazaPressure = clamp(1 - centerDistance / Math.max(0.001, safeRadiusTiles * 0.42), 0, 1);
  const northSouthPathPressure =
    centerDistance < safeRadiusTiles * 0.95
      ? clamp(1 - Math.abs(x + 0.5 - centerX) / 0.95, 0, 1)
      : 0;
  const eastWestPathPressure =
    centerDistance < safeRadiusTiles * 0.95
      ? clamp(1 - Math.abs(y + 0.5 - centerY) / 0.9, 0, 1)
      : 0;

  const riverCenter =
    rows * 0.96 +
    noise2d(x * 0.12, 0, profile.seed + 401) * 2.2 -
    noise2d(x * 0.3, 4, profile.seed + 503) * 0.8;
  const riverDistance = Math.abs(y - riverCenter);
  const riverBand = y > rows * 0.74 ? 1 : 0;
  const waterPressure = riverBand * clamp(1 - riverDistance / 0.52, 0, 1);
  const shorePressure = riverBand * clamp(1 - riverDistance / 1.7, 0, 1);

  const broad = noise2d(x * 0.16, y * 0.16, profile.seed + 101);
  const mid = noise2d(x * 0.32, y * 0.32, profile.seed + 211);
  const grain = noise2d(x * 0.78, y * 0.78, profile.seed + 307);
  const rockCluster = broad * 0.72 + mid * 0.52 + grain * 0.18;
  const dryCluster = broad * 0.36 + mid * 0.7 - grain * 0.1;
  const tileElevation =
    (vertexHeight(x, y, cols, rows, safeRadiusTiles, profile) +
      vertexHeight(x + 1, y, cols, rows, safeRadiusTiles, profile) +
      vertexHeight(x + 1, y + 1, cols, rows, safeRadiusTiles, profile) +
      vertexHeight(x, y + 1, cols, rows, safeRadiusTiles, profile)) /
    4;
  const elevation = clamp(
    (tileElevation - profile.minElevation) / Math.max(1, profile.maxElevation - profile.minElevation),
    0,
    1,
  );
  const rockiness = clamp((rockCluster + 0.22) / 0.95, 0, 1);
  const dryness = clamp((dryCluster + 0.18) / 0.9, 0, 1);
  const moisture = clamp(1 - dryness * 0.62 + shorePressure * 0.72 + waterPressure, 0, 1);
  const shorePathPressure = shorePressure * 0.42;
  const pathPressure = Math.max(northSouthPathPressure, eastWestPathPressure, shorePathPressure);
  const vegetation = clamp((1 - rockiness * 0.7) * (0.48 + moisture * 0.55) * (1 - settlementPressure * 0.78), 0, 1);
  const detailDensity = clamp(
    0.07 + rockiness * 0.22 + vegetation * 0.22 - plazaPressure * 0.72 - pathPressure * 0.38,
    0,
    1,
  );

  return {
    elevation,
    moisture,
    rockiness,
    dryness,
    settlementPressure,
    plazaPressure,
    pathPressure,
    northSouthPathPressure,
    eastWestPathPressure,
    shorePathPressure,
    waterPressure,
    shorePressure,
    vegetation,
    detailDensity,
  };
}

export function materialForBiome(biome) {
  if (biome.waterPressure > 0.42) return "water";
  if (biome.shorePressure > 0.32) return "shore";
  if (biome.plazaPressure > 0) return "settlement";
  if (biome.pathPressure > 0.05) return "dirt";
  if (biome.rockiness > 0.88 && biome.settlementPressure < 0.2) return "rock";
  if (biome.rockiness > 0.72 && biome.elevation > 0.66 && biome.settlementPressure < 0.2) return "rock";
  if (biome.rockiness > 0.58 || biome.dryness > 0.67 || biome.shorePressure > 0.02) {
    return "dirt";
  }
  return "grass";
}
