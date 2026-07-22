import { vertexHeight } from "./terrain-height.js";
import { clamp, noise2d } from "./terrain-noise.js";
import { defaultTerrainProfile } from "./terrain-profile.js";
import { trailFieldAt } from "./terrain-trails.js";

export function materialForTile(x, y, cols, rows, safeRadiusTiles, profile = defaultTerrainProfile()) {
  return materialForBiome(biomeForTile(x, y, cols, rows, safeRadiusTiles, profile));
}

// centerline of the stream (in tile x) at a given tile y — exported so
// composition kits (reedbeds, fords) and the water painter can anchor on
// the actual channel. Accepts fractional y so paint can sample smoothly.
// Kept gentle (one broad bend, small detail) so the near-horizontal runs
// that produced staircase elbows never appear, and based east of the
// north-south road axis so channel and road stop coinciding.
export function streamCenterAt(y, cols, rows, profile = defaultTerrainProfile()) {
  const streamT = (y + 0.5) / rows;
  return (
    cols *
      (0.66 +
        0.09 * Math.sin(streamT * Math.PI * 1.9 + 0.4) +
        0.02 * Math.sin(streamT * Math.PI * 4.1)) +
    noise2d(y * 0.07, 9, profile.seed + 401) * 0.8
  );
}

// road pressures at a (possibly fractional) tile coordinate — the same
// bands biomeForTile uses, exported so the water painter can shallow the
// channel into a gravel ford where a road actually crosses
export function roadPressuresAt(x, y, cols, rows, profile = defaultTerrainProfile()) {
  const centerX = cols / 2;
  const centerY = rows / 2;
  const centerDistance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
  const nsAxis = centerX + noise2d(y * 0.09, 3, profile.seed + 601) * 3.4;
  const ewAxis = centerY + noise2d(x * 0.09, 7, profile.seed + 653) * 3.0;
  const roadReach = clamp(1.18 - centerDistance / (Math.min(cols, rows) * 0.62), 0, 1);
  return {
    northSouth: clamp(1 - Math.abs(x + 0.5 - nsAxis) / 0.95, 0, 1) * roadReach,
    eastWest: clamp(1 - Math.abs(y + 0.5 - ewAxis) / 0.9, 0, 1) * roadReach,
  };
}

export function biomeForTile(x, y, cols, rows, safeRadiusTiles, profile = defaultTerrainProfile()) {
  const centerX = cols / 2;
  const centerY = rows / 2;
  const centerDistance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
  const settlementPressure = clamp(1 - centerDistance / Math.max(0.001, safeRadiusTiles * 0.58), 0, 1);
  const plazaPressure = clamp(1 - centerDistance / Math.max(0.001, safeRadiusTiles * 0.42), 0, 1);
  // roads run the breadth of the map, wandering with noise so they read as
  // worn trails rather than surveyed lines; pressure fades toward the far
  // edges so trails peter out instead of slamming into the border
  const hasAuthoredTrails = Array.isArray(profile.trails) && profile.trails.length > 0;
  const authoredTrail = trailFieldAt(x + 0.5, y + 0.5, profile.trails);
  const roads = hasAuthoredTrails
    ? { northSouth: authoredTrail.northSouth, eastWest: authoredTrail.eastWest }
    : roadPressuresAt(x, y, cols, rows, profile);
  const northSouthPathPressure = roads.northSouth;
  const eastWestPathPressure = roads.eastWest;

  // a stream S-curves through the east half of the map: enters the north
  // edge, bends past the settlement, exits south — instead of the old river
  // that hugged the bottom map edge where nobody ever saw it
  const streamDistance = Math.abs(x + 0.5 - streamCenterAt(y, cols, rows, profile));
  const waterPressure = clamp(1 - streamDistance / 1.35, 0, 1);
  const shorePressure = clamp(1 - streamDistance / 3.1, 0, 1);

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
  // no implicit beach path along the stream: banks stay biome ground, and
  // only real roads count toward the ford check in materialForBiome
  const shorePathPressure = 0;
  const pathPressure = Math.max(northSouthPathPressure, eastWestPathPressure);
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
  // ford: where a trail meets the stream the water shallows to walkable
  // shore, so the road network stays connected across the channel
  if (biome.waterPressure > 0.42) {
    return biome.pathPressure > 0.4 ? "shore" : "water";
  }
  if (biome.shorePressure > 0.55) return "shore";
  if (biome.plazaPressure > 0) return "settlement";
  if (biome.pathPressure > 0.05) return "dirt";
  if (biome.rockiness > 0.88 && biome.settlementPressure < 0.2) return "rock";
  if (biome.rockiness > 0.72 && biome.elevation > 0.66 && biome.settlementPressure < 0.2) return "rock";
  if (biome.rockiness > 0.58 || biome.dryness > 0.67) {
    return "dirt";
  }
  return "grass";
}
