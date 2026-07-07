import { PROJECTION, projectMap } from "./projection.js";
import {
  compositionKitMembership,
  createTerrainCompositionKits,
  materialForCompositionKit,
} from "./terrain-composition-kit.js";

export const TERRAIN_MATERIALS = {
  grass: {
    fill: "#496a3f",
    light: "#7f935a",
    dark: "#273d2c",
    stroke: "rgba(25, 35, 28, 0.08)",
    transition: "#36573b",
  },
  field: {
    fill: "#5f7043",
    light: "#8d965e",
    dark: "#35422d",
    stroke: "rgba(42, 55, 35, 0.08)",
    transition: "#637345",
  },
  dirt: {
    fill: "#6e4e39",
    light: "#9a714f",
    dark: "#3d2d26",
    stroke: "rgba(42, 31, 24, 0.1)",
    transition: "#513a2c",
  },
  stone: {
    fill: "#626966",
    light: "#8d9088",
    dark: "#343b39",
    stroke: "rgba(31, 35, 34, 0.1)",
    transition: "#4a524f",
  },
  water: {
    fill: "#315f73",
    light: "#6fa5ad",
    dark: "#1b3f52",
    stroke: "rgba(16, 51, 63, 0.1)",
    transition: "#b49f68",
  },
  settlement: {
    fill: "#afa487",
    light: "#d2c49f",
    dark: "#766c58",
    stroke: "rgba(78, 67, 52, 0.09)",
    transition: "#8f7d60",
  },
};

const MATERIAL_PRIORITY = ["water", "stone", "dirt", "settlement", "field", "grass"];
const TERRAIN_CHUNK_TILES = 8;

export function buildTerrain(map) {
  const profile = terrainProfile(map);
  const cols = Math.ceil(map.width / profile.unitsPerTile);
  const rows = Math.ceil(map.height / profile.unitsPerTile);
  const safeRadiusTiles = map.safeZoneRadius / profile.unitsPerTile;
  const compositionKits = createTerrainCompositionKits(cols, rows, safeRadiusTiles, profile);
  const tiles = [];

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const biome = biomeForTile(x, y, cols, rows, safeRadiusTiles, profile);
      const material = materialForCompositionKit(x, y, materialForBiome(biome), biome, compositionKits);
      const heights = cornerHeights(x, y, cols, rows, safeRadiusTiles, material, profile);
      const height = terrainHeightMetadata(heights);
      const composition = terrainCompositionForTile(
        x,
        y,
        material,
        biome,
        cols,
        rows,
        safeRadiusTiles,
        profile,
        height,
        compositionKits,
      );
      tiles.push({
        x,
        y,
        material,
        biome,
        composition,
        heights,
        height,
        sloped: height.range > 0,
        transitions: transitionsForTile(x, y, material, cols, rows, safeRadiusTiles, profile, compositionKits),
        decals: decalsForTile(x, y, material, profile, biome, composition),
        elevationEdges: [],
      });
    }
  }
  for (const tile of tiles) {
    tile.elevationEdges = elevationEdgesForTile(tile, tiles, cols, rows);
  }
  const details = terrainDetails(tiles, cols, rows, safeRadiusTiles, profile, compositionKits);
  const detailAuthority = terrainDetailAuthority(details, profile);
  const chunks = terrainChunks(tiles, cols, rows);

  return {
    cols,
    rows,
    width: map.width,
    height: map.height,
    safeRadiusTiles,
    profile,
    compositionKits,
    tiles,
    chunks,
    details,
    detailAuthority,
  };
}

export function terrainTileAt(terrain, tileX, tileY) {
  if (!terrain || tileX < 0 || tileY < 0 || tileX >= terrain.cols || tileY >= terrain.rows) {
    return null;
  }
  return terrain.tiles[tileY * terrain.cols + tileX] ?? null;
}

export function terrainHeightAtWorld(terrain, worldX, worldY) {
  if (!terrain) return 0;
  const unitsPerTile = terrain.profile?.unitsPerTile ?? PROJECTION.unitsPerTile;
  const mapX = clamp(worldX / unitsPerTile, 0, Math.max(0, terrain.cols - 0.001));
  const mapY = clamp(worldY / unitsPerTile, 0, Math.max(0, terrain.rows - 0.001));
  const tileX = Math.floor(mapX);
  const tileY = Math.floor(mapY);
  const tile = terrainTileAt(terrain, tileX, tileY);
  if (!tile) return 0;

  const fx = mapX - tileX;
  const fy = mapY - tileY;
  return bilerp(tile.heights.nw, tile.heights.ne, tile.heights.sw, tile.heights.se, fx, fy);
}

export function terrainWalkabilityAtWorld(terrain, worldX, worldY) {
  if (!terrain) {
    return {
      walkable: false,
      reason: "missing-terrain",
      tile: null,
      blockers: [],
    };
  }
  const unitsPerTile = terrain.profile?.unitsPerTile ?? PROJECTION.unitsPerTile;
  const mapX = worldX / unitsPerTile;
  const mapY = worldY / unitsPerTile;
  const tileX = Math.floor(mapX);
  const tileY = Math.floor(mapY);
  const tile = terrainTileAt(terrain, tileX, tileY);
  if (!tile) {
    return {
      walkable: false,
      reason: "out-of-bounds",
      tile: null,
      blockers: [],
    };
  }
  if (tile.material === "water") {
    return {
      walkable: false,
      reason: "water",
      tile,
      blockers: [],
    };
  }
  const maxWalkableStep = terrain.profile?.maxWalkableStep ?? 1;
  if ((tile.height?.range ?? 0) > maxWalkableStep + 1.2) {
    return {
      walkable: false,
      reason: "steep",
      tile,
      blockers: [],
    };
  }
  const blockers = terrainDetailBlockersAtWorld(terrain, worldX, worldY);
  if (blockers.length > 0) {
    return {
      walkable: false,
      reason: "blocked-detail",
      tile,
      blockers,
    };
  }
  return {
    walkable: true,
    reason: "walkable",
    tile,
    blockers: [],
  };
}

export function terrainDetailBlockersAtWorld(terrain, worldX, worldY) {
  if (!terrain || !Array.isArray(terrain.details)) return [];
  const unitsPerTile = terrain.profile?.unitsPerTile ?? PROJECTION.unitsPerTile;
  return terrain.details.filter((detail) => {
    if (!detail.footprint?.blocksMovement) return false;
    const halfWidth = Math.max(0.12, detail.footprint.widthTiles / 2) * unitsPerTile;
    const halfHeight = Math.max(0.12, detail.footprint.heightTiles / 2) * unitsPerTile;
    const dx = Math.abs(worldX - detail.x);
    const dy = Math.abs(worldY - detail.y);
    return dx <= halfWidth && dy <= halfHeight;
  });
}

export function projectTerrainTile(tile, origin) {
  return {
    nw: projectMap(tile.x, tile.y, tile.heights.nw, origin),
    ne: projectMap(tile.x + 1, tile.y, tile.heights.ne, origin),
    se: projectMap(tile.x + 1, tile.y + 1, tile.heights.se, origin),
    sw: projectMap(tile.x, tile.y + 1, tile.heights.sw, origin),
  };
}

export function terrainFacets(tile) {
  if (!tile?.sloped) return [];

  const { slopeX, slopeY, range } = tile.height ?? terrainHeightMetadata(tile.heights);
  const alpha = clamp(0.2 + range * 0.055, 0.2, 0.48);
  const lightBias = ((tile.height?.light ?? 0.58) - 0.58) * 0.18;

  return [
    {
      name: "right",
      corners: ["nw", "ne", "se"],
      shade: clamp(slopeX * 0.1 - slopeY * 0.08 - 0.05 + lightBias, -0.36, 0.32),
      alpha,
    },
    {
      name: "left",
      corners: ["nw", "se", "sw"],
      shade: clamp(slopeY * 0.1 - slopeX * 0.08 + 0.06 + lightBias, -0.34, 0.36),
      alpha: alpha * 0.9,
    },
  ];
}

function terrainChunks(tiles, cols, rows) {
  const chunks = [];
  for (let y = 0; y < rows; y += TERRAIN_CHUNK_TILES) {
    for (let x = 0; x < cols; x += TERRAIN_CHUNK_TILES) {
      const chunkTiles = [];
      const maxY = Math.min(rows, y + TERRAIN_CHUNK_TILES);
      const maxX = Math.min(cols, x + TERRAIN_CHUNK_TILES);
      for (let tileY = y; tileY < maxY; tileY += 1) {
        for (let tileX = x; tileX < maxX; tileX += 1) {
          chunkTiles.push(tiles[tileY * cols + tileX]);
        }
      }
      const height = chunkHeightMetadata(chunkTiles);
      chunks.push({
        x,
        y,
        cols: maxX - x,
        rows: maxY - y,
        height,
        tiles: chunkTiles,
      });
    }
  }
  return chunks;
}

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
    0.18 + rockiness * 0.38 + vegetation * 0.42 - plazaPressure * 0.6 - pathPressure * 0.26,
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

function materialForBiome(biome) {
  if (biome.waterPressure > 0) return "water";
  if (biome.plazaPressure > 0) return "settlement";
  if (biome.pathPressure > 0.05) return "dirt";
  if (biome.rockiness > 0.86 && biome.settlementPressure < 0.2) return "stone";
  if (biome.rockiness > 0.58 || biome.dryness > 0.67 || biome.shorePressure > 0.02) {
    return "dirt";
  }
  return "grass";
}

function terrainCompositionForTile(x, y, material, biome, cols, rows, safeRadiusTiles, profile, height, compositionKits = []) {
  const elevationBand =
    biome.elevation > 0.72 ? "high" : biome.elevation < 0.26 || material === "water" ? "low" : "mid";
  const moistureBand =
    biome.waterPressure > 0 ? "water" : biome.moisture > 0.72 ? "wet" : biome.moisture < 0.34 ? "dry" : "temperate";
  const roadAxis = roadAxisForBiome(biome);
  const centerDistance = Math.hypot(x + 0.5 - cols / 2, y + 0.5 - rows / 2);
  const protectedCenter = centerDistance < safeRadiusTiles * 0.9;
  const groveScore = biome.vegetation * (1 - biome.rockiness * 0.58) * (1 - biome.pathPressure * 0.8);
  const ridgeScore = biome.rockiness * 0.65 + biome.elevation * 0.35 + clamp((height.range - 1) / 3, 0, 1) * 0.24;
  const detailBudget = clamp(
    biome.detailDensity +
      (ridgeScore > 0.78 ? 0.2 : 0) +
      (groveScore > 0.7 ? 0.18 : 0) -
      biome.plazaPressure * 0.55 -
      biome.pathPressure * 0.24,
    0,
    1,
  );
  let zone = "meadow";
  let detailFamily = "grass";
  let objectBand = "open";

  if (material === "water") {
    zone = "water";
    detailFamily = "water";
    objectBand = "none";
  } else if (biome.plazaPressure > 0.18) {
    zone = "plaza";
    detailFamily = "settlement";
    objectBand = "settlement";
  } else if (biome.pathPressure > 0.18) {
    zone = "road";
    detailFamily = biome.shorePathPressure >= biome.pathPressure ? "shore-road" : "road";
    objectBand = "open";
  } else if (biome.shorePressure > 0.16) {
    zone = "shore";
    detailFamily = "shore";
    objectBand = "shore";
  } else if (ridgeScore > 0.78 || material === "stone") {
    zone = "ridge";
    detailFamily = "rock";
    objectBand = "rock";
  } else if (!protectedCenter && groveScore > 0.68) {
    zone = "grove";
    detailFamily = "woodland";
    objectBand = "vegetation";
  } else if (material === "dirt") {
    zone = "scrub";
    detailFamily = "scrub";
    objectBand = biome.rockiness > 0.55 ? "rock" : "open";
  }
  const kit = compositionKitMembership(x, y, compositionKits, zone, biome);
  if (kit?.kind === "ancient-viaduct") {
    if (kit.role === "causeway") {
      zone = "ridge";
      detailFamily = "ruin-road";
      objectBand = "ruin";
    } else if (kit.role === "rubble") {
      detailFamily = "ruin-rubble";
      objectBand = "ruin";
    }
  } else if (kit?.kind === "sunken-courtyard") {
    zone = kit.role === "courtyard-rubble" ? "ridge" : "plaza";
    detailFamily = kit.role === "stairs" ? "ruin-stairs" : kit.role.startsWith("wall") ? "ruin-wall" : "ruin-courtyard";
    objectBand = kit.role.startsWith("wall") || kit.role === "stairs" ? "architecture" : "ruin";
  }

  return {
    zone,
    elevationBand,
    moistureBand,
    roadAxis,
    detailFamily,
    objectBand,
    kitId: kit?.id ?? null,
    kitKind: kit?.kind ?? null,
    kitRole: kit?.role ?? "none",
    detailBudget,
    ridgeScore: clamp(ridgeScore, 0, 1),
    groveScore: clamp(groveScore, 0, 1),
  };
}

function roadAxisForBiome(biome) {
  const northSouth = biome.northSouthPathPressure ?? 0;
  const eastWest = biome.eastWestPathPressure ?? 0;
  const shore = biome.shorePathPressure ?? 0;
  if (shore > northSouth && shore > eastWest) return "shore";
  if (Math.abs(northSouth - eastWest) < 0.08 && Math.max(northSouth, eastWest) > 0.16) return "cross";
  if (northSouth > eastWest && northSouth > 0.12) return "north-south";
  if (eastWest > 0.12) return "east-west";
  return "none";
}

function cornerHeights(x, y, cols, rows, safeRadiusTiles, material, profile) {
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

function vertexHeight(x, y, cols, rows, safeRadiusTiles, profile) {
  const centerDistance = Math.hypot(x - cols / 2, y - rows / 2);
  if (centerDistance < safeRadiusTiles * 0.58) return 0;

  const wave = Math.sin(x * 0.47) * 1.2 + Math.cos(y * 0.39) * 1.1 + Math.sin((x - y) * 0.24);
  const ridged = noise2d(x * 0.7, y * 0.7, profile.seed) * 1.7;
  return clamp(Math.round(wave + ridged), profile.minElevation, profile.maxElevation);
}

function transitionsForTile(x, y, material, cols, rows, safeRadiusTiles, profile, compositionKits = []) {
  const edges = [
    ["north", x, y - 1],
    ["east", x + 1, y],
    ["south", x, y + 1],
    ["west", x - 1, y],
  ];
  const transitions = [];

  for (const [edge, nx, ny] of edges) {
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const nextMaterial = materialForTileWithCompositionKits(nx, ny, cols, rows, safeRadiusTiles, profile, compositionKits);
    if (nextMaterial === material) continue;
    if (materialPriority(nextMaterial) < materialPriority(material)) continue;
    transitions.push({
      type: "edge",
      edge,
      from: material,
      to: nextMaterial,
      pair: transitionPair(material, nextMaterial),
      family: transitionFamily(material, nextMaterial),
      seed: transitionSeed(x, y, edge, material, nextMaterial, profile.seed),
      color: TERRAIN_MATERIALS[nextMaterial].transition,
      mask: {
        type: "edge",
        edge,
        depth: transitionDepth(material, nextMaterial),
      },
    });
  }
  for (const corner of cornerTransitionsForTile(x, y, material, cols, rows, safeRadiusTiles, profile, compositionKits)) {
    transitions.push(corner);
  }
  return transitions;
}

function cornerTransitionsForTile(x, y, material, cols, rows, safeRadiusTiles, profile, compositionKits = []) {
  const corners = [
    ["northEast", x + 1, y - 1, ["north", "east"]],
    ["southEast", x + 1, y + 1, ["east", "south"]],
    ["southWest", x - 1, y + 1, ["south", "west"]],
    ["northWest", x - 1, y - 1, ["west", "north"]],
  ];
  const transitions = [];

  for (const [corner, nx, ny, adjacentEdges] of corners) {
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const nextMaterial = materialForTileWithCompositionKits(nx, ny, cols, rows, safeRadiusTiles, profile, compositionKits);
    if (nextMaterial === material) continue;
    if (materialPriority(nextMaterial) < materialPriority(material)) continue;
    const adjacentHasSameTransition = adjacentEdges.some((edge) =>
      transitionsForNeighborMaterial(x, y, edge, nextMaterial, cols, rows, safeRadiusTiles, profile, compositionKits),
    );
    if (adjacentHasSameTransition) continue;
    transitions.push({
      type: "corner",
      corner,
      from: material,
      to: nextMaterial,
      pair: transitionPair(material, nextMaterial),
      family: transitionFamily(material, nextMaterial),
      seed: transitionSeed(x, y, corner, material, nextMaterial, profile.seed),
      color: TERRAIN_MATERIALS[nextMaterial].transition,
      mask: {
        type: "corner",
        corner,
        depth: transitionDepth(material, nextMaterial) * 0.92,
      },
    });
  }

  return transitions;
}

function transitionsForNeighborMaterial(x, y, edge, material, cols, rows, safeRadiusTiles, profile, compositionKits = []) {
  const offset = {
    north: [0, -1],
    east: [1, 0],
    south: [0, 1],
    west: [-1, 0],
  }[edge];
  if (!offset) return false;
  const nx = x + offset[0];
  const ny = y + offset[1];
  if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;
  return materialForTileWithCompositionKits(nx, ny, cols, rows, safeRadiusTiles, profile, compositionKits) === material;
}

function materialForTileWithCompositionKits(x, y, cols, rows, safeRadiusTiles, profile, compositionKits) {
  if (x < 0 || y < 0 || x >= cols || y >= rows) return "grass";
  const biome = biomeForTile(x, y, cols, rows, safeRadiusTiles, profile);
  return materialForCompositionKit(x, y, materialForBiome(biome), biome, compositionKits);
}

function transitionDepth(fromMaterial, toMaterial) {
  if (toMaterial === "water") return 0.46;
  if (fromMaterial === "water") return 0.42;
  if (toMaterial === "settlement") return 0.38;
  if (toMaterial === "stone") return 0.36;
  if (toMaterial === "grass" || toMaterial === "field") return 0.3;
  return 0.34;
}

function transitionPair(fromMaterial, toMaterial) {
  return `${fromMaterial}->${toMaterial}`;
}

function transitionFamily(fromMaterial, toMaterial) {
  if (fromMaterial === "water" || toMaterial === "water") return "shore";
  if (fromMaterial === "settlement" || toMaterial === "settlement") return "plaza";
  if (fromMaterial === "stone" || toMaterial === "stone") return "rocky";
  if (fromMaterial === "dirt" || toMaterial === "dirt") return "path";
  return "soft";
}

function transitionSeed(x, y, edge, fromMaterial, toMaterial, seed) {
  let hash = Math.imul(x + 193, 374761393) ^ Math.imul(y + 389, 668265263) ^ Math.imul(seed + 83, 2246822519);
  const text = `${edge}:${fromMaterial}:${toMaterial}`;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 3266489917);
  }
  return hash >>> 0;
}

function decalsForTile(x, y, material, profile, biome, composition = null) {
  if (material === "water" || material === "settlement") return [];
  const amount = biome.detailDensity > 0.58 && Math.abs(hashUnit(x, y, profile.seed + 17)) > 0.42 ? 2 : 1;
  const decals = [];
  for (let index = 0; index < amount; index += 1) {
    const seed = index + 1;
    const u = 0.22 + Math.abs(hashUnit(x, y, profile.seed + seed)) * 0.56;
    const v = 0.2 + Math.abs(hashUnit(x, y, profile.seed + seed + 11)) * 0.58;
    const variant = hashUnit(x, y, profile.seed + seed + 23);
    decals.push({
      kind: biome.rockiness > 0.58 || material === "stone" || variant > 0.48 ? "pebble" : "tuft",
      u,
      v,
      size: 2 + Math.floor(Math.abs(hashUnit(x, y, profile.seed + seed + 31)) * 4),
    });
  }
  if (composition?.kitKind === "ancient-viaduct") {
    const extra = composition.kitRole === "causeway" ? 3 : 2;
    for (let index = 0; index < extra; index += 1) {
      const seed = 41 + index;
      const roll = hash01(x, y, profile.seed + seed);
      decals.push({
        kind: index === 0 && composition.kitRole === "causeway" ? "crack" : roll > 0.58 ? "moss" : "pebble",
        u: 0.18 + hash01(x, y, profile.seed + seed + 3) * 0.64,
        v: 0.18 + hash01(x, y, profile.seed + seed + 7) * 0.64,
        size: 3 + Math.floor(hash01(x, y, profile.seed + seed + 13) * 5),
      });
    }
  }
  if (composition?.kitKind === "sunken-courtyard") {
    const extra = composition.kitRole === "courtyard-floor" ? 3 : 2;
    for (let index = 0; index < extra; index += 1) {
      const seed = 71 + index;
      const roll = hash01(x, y, profile.seed + seed);
      decals.push({
        kind: composition.kitRole === "courtyard-floor" && index === 0 ? "masonry-joint" : roll > 0.62 ? "crack" : "moss",
        u: 0.14 + hash01(x, y, profile.seed + seed + 5) * 0.72,
        v: 0.14 + hash01(x, y, profile.seed + seed + 9) * 0.72,
        size: 3 + Math.floor(hash01(x, y, profile.seed + seed + 17) * 5),
      });
    }
  }
  return decals;
}

function terrainDetails(tiles, cols, rows, safeRadiusTiles, profile, compositionKits = []) {
  const occupiedFootprints = new Set();
  const details = [];
  const tilesByCoord = new Map(tiles.map((tile) => [`${tile.x}:${tile.y}`, tile]));
  for (const kit of compositionKits) {
    details.push(...compositionKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints));
  }
  for (const tile of tiles) {
    details.push(...detailsForTile(tile, cols, rows, safeRadiusTiles, profile, occupiedFootprints));
  }
  return details;
}

function compositionKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints) {
  if (kit.kind === "sunken-courtyard") {
    return courtyardKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints);
  }
  if (kit.kind !== "ancient-viaduct") return [];
  const details = [];
  const placements = [
    { dx: -3, dy: 3, kind: "ruin", role: "broken-pier", scale: [0.82, 1.04], u: 0.55, v: 0.48 },
    { dx: 0, dy: 0, kind: "ruin", role: "fallen-arch", scale: [0.7, 0.92], u: 0.48, v: 0.54 },
    { dx: 3, dy: -3, kind: "ruin", role: "sunken-pier", scale: [0.76, 1], u: 0.52, v: 0.5 },
    { dx: -2, dy: 1, kind: "boulder", role: "abutment-stone", scale: [0.58, 0.84], u: 0.32, v: 0.72 },
    { dx: 1, dy: -2, kind: "boulder", role: "abutment-stone", scale: [0.54, 0.8], u: 0.66, v: 0.34 },
    { dx: -4, dy: 2, kind: "rock", role: "fallen-rubble", scale: [0.46, 0.62], u: 0.44, v: 0.58 },
    { dx: 4, dy: -2, kind: "rock", role: "fallen-rubble", scale: [0.44, 0.62], u: 0.58, v: 0.44 },
    { dx: -1, dy: 2, kind: "pebble", role: "stone-chips", scale: [0.24, 0.36], u: 0.28, v: 0.42 },
    { dx: 2, dy: -1, kind: "pebble", role: "stone-chips", scale: [0.24, 0.36], u: 0.74, v: 0.52 },
    { dx: -3, dy: 4, kind: "tuft", role: "overgrowth", scale: [0.34, 0.52], u: 0.66, v: 0.68 },
    { dx: 4, dy: -3, kind: "flower", role: "overgrowth", scale: [0.28, 0.44], u: 0.4, v: 0.36 },
  ];

  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    const tileX = Math.round(kit.x + placement.dx);
    const tileY = Math.round(kit.y + placement.dy);
    if (tileX < 0 || tileY < 0 || tileX >= cols || tileY >= rows) continue;
    const tile = tilesByCoord.get(`${tileX}:${tileY}`);
    if (!tile || tile.material === "water" || tile.material === "settlement") continue;
    const roll = hash01(tileX, tileY, kit.seed + index * 29);
    tryAddDetail(
      details,
      tile,
      profile,
      placement.kind,
      roll,
      placement.scale[0],
      placement.scale[1],
      occupiedFootprints,
      cols,
      rows,
      {
        kitId: kit.id,
        kitKind: kit.kind,
        kitRole: placement.role,
        u: placement.u,
        v: placement.v,
      },
    );
  }
  return details;
}

function courtyardKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints) {
  const details = [];
  const placements = [
    { dx: -2, dy: -2, kind: "wall", role: "wall-north", scale: [0.92, 1.06], u: 0.5, v: 0.28 },
    { dx: 0, dy: -2, kind: "wall", role: "wall-north", scale: [0.88, 1.02], u: 0.5, v: 0.3 },
    { dx: 2, dy: -2, kind: "wall", role: "wall-north", scale: [0.9, 1.04], u: 0.5, v: 0.32 },
    { dx: -3, dy: 0, kind: "wall", role: "wall-west", scale: [0.78, 0.96], u: 0.3, v: 0.52 },
    { dx: 3, dy: 0, kind: "wall", role: "wall-east", scale: [0.8, 0.98], u: 0.7, v: 0.5 },
    { dx: -2, dy: 2, kind: "foundation", role: "broken-floor", scale: [0.72, 0.9], u: 0.48, v: 0.54 },
    { dx: 0, dy: 2, kind: "stairs", role: "stairs", scale: [0.86, 1.02], u: 0.5, v: 0.62 },
    { dx: 2, dy: 2, kind: "foundation", role: "broken-floor", scale: [0.7, 0.88], u: 0.52, v: 0.56 },
    { dx: -1, dy: 0, kind: "foundation", role: "sunken-floor", scale: [0.62, 0.8], u: 0.42, v: 0.46 },
    { dx: 1, dy: 0, kind: "foundation", role: "sunken-floor", scale: [0.62, 0.8], u: 0.58, v: 0.5 },
    { dx: -4, dy: 1, kind: "rock", role: "collapsed-masonry", scale: [0.4, 0.62], u: 0.55, v: 0.46 },
    { dx: 4, dy: 1, kind: "pebble", role: "collapsed-masonry", scale: [0.28, 0.4], u: 0.36, v: 0.58 },
    { dx: -3, dy: 3, kind: "tuft", role: "overgrowth", scale: [0.32, 0.5], u: 0.62, v: 0.62 },
    { dx: 3, dy: -3, kind: "flower", role: "overgrowth", scale: [0.28, 0.42], u: 0.42, v: 0.44 },
  ];

  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    const tileX = Math.round(kit.x + placement.dx);
    const tileY = Math.round(kit.y + placement.dy);
    if (tileX < 0 || tileY < 0 || tileX >= cols || tileY >= rows) continue;
    const tile = tilesByCoord.get(`${tileX}:${tileY}`);
    if (!tile || tile.material === "water") continue;
    const roll = hash01(tileX, tileY, kit.seed + index * 31);
    tryAddDetail(
      details,
      tile,
      profile,
      placement.kind,
      roll,
      placement.scale[0],
      placement.scale[1],
      occupiedFootprints,
      cols,
      rows,
      {
        kitId: kit.id,
        kitKind: kit.kind,
        kitRole: placement.role,
        u: placement.u,
        v: placement.v,
      },
    );
  }
  return details;
}

function detailsForTile(tile, cols, rows, safeRadiusTiles, profile, occupiedFootprints) {
  if (tile.material === "water" || tile.material === "settlement") return [];

  const centerDistance = Math.hypot(tile.x + 0.5 - cols / 2, tile.y + 0.5 - rows / 2);
  if (centerDistance < safeRadiusTiles * 0.9) return [];

  const details = [];
  const baseRoll = hash01(tile.x, tile.y, profile.seed + 701);
  const secondRoll = hash01(tile.x, tile.y, profile.seed + 809);
  const thirdRoll = hash01(tile.x, tile.y, profile.seed + 907);
  const density = tile.composition?.detailBudget ?? tile.biome?.detailDensity ?? 0.5;
  const rockiness = tile.biome?.rockiness ?? 0.5;
  const vegetation = tile.biome?.vegetation ?? 0.5;
  const family = tile.composition?.detailFamily ?? "grass";
  const zone = tile.composition?.zone ?? "meadow";
  const zoneRoll = hash01(tile.x, tile.y, profile.seed + 619);

  if (zone === "grove" && zoneRoll > 0.86 - vegetation * 0.22) {
    if (tryAddDetail(details, tile, profile, "tree", zoneRoll, 0.74, 1.05, occupiedFootprints, cols, rows)) {
      if (secondRoll > 0.82 - density * 0.18) {
        tryAddDetail(details, tile, profile, "scrub", secondRoll, 0.36, 0.6, occupiedFootprints, cols, rows);
      }
      return details;
    }
  }

  if (zone === "shore" && zoneRoll > 0.78 - density * 0.26) {
    tryAddDetail(details, tile, profile, "reeds", zoneRoll, 0.42, 0.78, occupiedFootprints, cols, rows);
  }

  if ((zone === "ridge" || zone === "scrub") && zoneRoll > 0.92 - rockiness * 0.12) {
    if (tryAddDetail(details, tile, profile, "ruin", zoneRoll, 0.58, 0.86, occupiedFootprints, cols, rows)) {
      return details;
    }
  }

  if ((zone === "ridge" || family === "rock") && zoneRoll > 0.8 - density * 0.2) {
    tryAddDetail(details, tile, profile, "boulder", zoneRoll, 0.48, 0.82, occupiedFootprints, cols, rows);
  }

  if (family === "shore") {
    if (baseRoll > 0.78 - density * 0.36) tryAddDetail(details, tile, profile, "scrub", baseRoll, 0.34, 0.62, occupiedFootprints, cols, rows);
    if (secondRoll > 0.84 - density * 0.32) tryAddDetail(details, tile, profile, "pebble", secondRoll, 0.2, 0.34, occupiedFootprints, cols, rows);
    if (thirdRoll > 0.93 - vegetation * 0.22) tryAddDetail(details, tile, profile, "tuft", thirdRoll, 0.28, 0.44, occupiedFootprints, cols, rows);
    return details;
  }

  if (family === "road" || family === "shore-road") {
    if (baseRoll > 0.86 - density * 0.22) tryAddDetail(details, tile, profile, "pebble", baseRoll, 0.18, 0.3, occupiedFootprints, cols, rows);
    if (family === "shore-road" && secondRoll > 0.9 - vegetation * 0.18) {
      tryAddDetail(details, tile, profile, "tuft", secondRoll, 0.24, 0.38, occupiedFootprints, cols, rows);
    }
    return details;
  }

  if ((family === "rock" || tile.material === "stone" || rockiness > 0.76) && baseRoll > 0.84 - density * 0.52) {
    tryAddDetail(details, tile, profile, "rock", baseRoll, 0.38, 0.58, occupiedFootprints, cols, rows);
    if (secondRoll > 0.9 - density * 0.24) {
      tryAddDetail(details, tile, profile, "pebble", secondRoll, 0.24, 0.38, occupiedFootprints, cols, rows);
    }
    return details;
  }

  if (tile.material === "dirt") {
    if (baseRoll > 0.93 - rockiness * 0.36) tryAddDetail(details, tile, profile, "rock", baseRoll, 0.28, 0.44, occupiedFootprints, cols, rows);
    if (secondRoll > 0.86 - density * 0.38) tryAddDetail(details, tile, profile, "pebble", secondRoll, 0.2, 0.34, occupiedFootprints, cols, rows);
    if (thirdRoll > 0.985 - vegetation * 0.08) tryAddDetail(details, tile, profile, "stump", thirdRoll, 0.34, 0.5, occupiedFootprints, cols, rows);
    return details;
  }

  if (family === "woodland" && baseRoll > 0.74 - density * 0.45) {
    tryAddDetail(details, tile, profile, baseRoll > 0.68 ? "scrub" : "tuft", baseRoll, 0.42, 0.78, occupiedFootprints, cols, rows);
    if (secondRoll > 0.84 - density * 0.28) {
      tryAddDetail(details, tile, profile, secondRoll > 0.7 ? "fallen-log" : "stump", secondRoll, 0.36, 0.58, occupiedFootprints, cols, rows);
    }
    if (thirdRoll > 0.92 - vegetation * 0.22) {
      tryAddDetail(details, tile, profile, "mushroom", thirdRoll, 0.26, 0.42, occupiedFootprints, cols, rows);
    }
    return details;
  }

  if ((tile.material === "grass" || tile.material === "field") && baseRoll > 0.9 - vegetation * 0.55) {
    tryAddDetail(details, tile, profile, grassDetailKind(baseRoll, thirdRoll), baseRoll, 0.34, 0.62, occupiedFootprints, cols, rows);
    if (secondRoll > 0.94 - density * 0.24) {
      tryAddDetail(details, tile, profile, "scrub", secondRoll, 0.42, 0.7, occupiedFootprints, cols, rows);
    }
    if (thirdRoll > 0.985 - vegetation * 0.08) {
      tryAddDetail(details, tile, profile, thirdRoll > 0.975 ? "fallen-log" : "mushroom", thirdRoll, 0.34, 0.52, occupiedFootprints, cols, rows);
    }
  }
  return details;
}

function tryAddDetail(details, tile, profile, kind, roll, minScale, maxScale, occupiedFootprints, cols, rows, options = {}) {
  const footprint = detailFootprint(kind);
  if (footprint.reserveRadiusTiles > 0 && !reserveDetailFootprint(tile, footprint.reserveRadiusTiles, occupiedFootprints, cols, rows)) {
    return false;
  }
  details.push(detailForTile(tile, profile, kind, roll, minScale, maxScale, footprint, options));
  return true;
}

function elevationEdgesForTile(tile, tiles, cols, rows) {
  if (tile.material === "water") return [];
  const neighbors = [
    ["north", tile.x, tile.y - 1],
    ["east", tile.x + 1, tile.y],
    ["south", tile.x, tile.y + 1],
    ["west", tile.x - 1, tile.y],
  ];
  const currentHeight = averageHeight(tile);
  const edges = [];

  for (const [edge, nx, ny] of neighbors) {
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const neighbor = tiles[ny * cols + nx];
    if (!neighbor || neighbor.material === "water") continue;
    const drop = currentHeight - averageHeight(neighbor);
    if (drop < 0.75) continue;
    edges.push({
      edge,
      drop: Math.min(3.5, drop),
      neighborMaterial: neighbor.material,
    });
  }
  return edges;
}

function averageHeight(tile) {
  return tile.height?.average ?? (tile.heights.nw + tile.heights.ne + tile.heights.se + tile.heights.sw) / 4;
}

function grassDetailKind(baseRoll, thirdRoll) {
  if (thirdRoll > 0.78) return "flower";
  if (baseRoll > 0.86 && thirdRoll < 0.28) return "mushroom";
  return "tuft";
}

function detailForTile(tile, profile, kind, roll, minScale, maxScale, footprint = detailFootprint(kind), options = {}) {
  const seed = Math.round(roll * 10000);
  const u = options.u ?? 0.18 + hash01(tile.x, tile.y, profile.seed + seed + 17) * 0.64;
  const v = options.v ?? 0.18 + hash01(tile.x, tile.y, profile.seed + seed + 29) * 0.64;
  const z = bilerp(tile.heights.nw, tile.heights.ne, tile.heights.sw, tile.heights.se, u, v);
  const metadata = detailMetadata(tile, profile, kind, seed);
  const kitId = options.kitId ?? tile.composition?.kitId ?? null;
  const kitKind = options.kitKind ?? tile.composition?.kitKind ?? null;
  const kitRole = options.kitRole ?? tile.composition?.kitRole ?? "none";
  const id = `${kitId ? `${kitId}-` : ""}${kind}-${tile.x}-${tile.y}-${seed}`;
  const authority = terrainDetailAuthorityMetadata(id, tile, profile, kind, seed, u, v, z, footprint, metadata, {
    kitId,
    kitKind,
    kitRole,
  });
  return {
    id,
    kind,
    ...metadata,
    material: tile.material,
    x: (tile.x + u) * profile.unitsPerTile,
    y: (tile.y + v) * profile.unitsPerTile,
    z,
    scale: (minScale + hash01(tile.x, tile.y, profile.seed + seed + 41) * (maxScale - minScale)) * (metadata.scaleMultiplier ?? 1),
    shade: hashUnit(tile.x, tile.y, profile.seed + seed + 53),
    zone: tile.composition?.zone ?? "meadow",
    objectBand: tile.composition?.objectBand ?? "open",
    kitId,
    kitKind,
    kitRole,
    footprint,
    tile: { x: tile.x, y: tile.y },
    anchor: { u, v, z },
    authority,
  };
}

function terrainDetailAuthorityMetadata(id, tile, profile, kind, seed, u, v, z, footprint, metadata, kit) {
  const hasResources = Array.isArray(metadata.resources) && metadata.resources.length > 0;
  const consumes = Array.isArray(metadata.consumes) ? metadata.consumes : [];
  return {
    schemaVersion: "duskfell-terrain-detail-authority-v1",
    stableKey: [
      profile.profile,
      profile.seed,
      kit.kitId ?? "procedural",
      kit.kitRole ?? "none",
      kind,
      tile.x,
      tile.y,
      seed,
    ].join(":"),
    source: kit.kitId ? "composition-kit" : "procedural-terrain",
    tile: { x: tile.x, y: tile.y },
    anchor: { u, v, z },
    generation: {
      profile: profile.profile,
      seed: profile.seed,
      detailSeed: seed,
      material: tile.material,
      zone: tile.composition?.zone ?? "meadow",
      objectBand: tile.composition?.objectBand ?? "open",
      kitId: kit.kitId,
      kitKind: kit.kitKind,
      kitRole: kit.kitRole,
    },
    collision: {
      blocksMovement: Boolean(footprint.blocksMovement),
      shape: "aabb",
      widthTiles: footprint.widthTiles,
      heightTiles: footprint.heightTiles,
      reserveRadiusTiles: footprint.reserveRadiusTiles,
    },
    resourceNodeId: hasResources ? `terrain-detail:${id}` : null,
    decayConsumer: consumes.length > 0 ? { consumes } : null,
  };
}

function terrainDetailAuthority(details, profile) {
  const blockers = [];
  const resourceNodes = [];
  const decayConsumers = [];

  for (const detail of details) {
    const authority = detail.authority;
    if (!authority) continue;
    const base = {
      id: detail.id,
      stableKey: authority.stableKey,
      kind: detail.kind,
      x: detail.x,
      y: detail.y,
      z: detail.z,
      tile: authority.tile,
      source: authority.source,
      kitId: detail.kitId,
      kitKind: detail.kitKind,
      kitRole: detail.kitRole,
    };
    if (authority.collision?.blocksMovement) {
      blockers.push({
        ...base,
        collision: authority.collision,
      });
    }
    if (authority.resourceNodeId) {
      resourceNodes.push({
        ...base,
        resourceNodeId: authority.resourceNodeId,
        resources: detail.resources,
        lifecycle: detail.lifecycle ?? null,
      });
    }
    if (authority.decayConsumer) {
      decayConsumers.push({
        ...base,
        ...authority.decayConsumer,
        resources: detail.resources ?? [],
        lifecycle: detail.lifecycle ?? null,
      });
    }
  }

  return {
    schemaVersion: "duskfell-terrain-detail-authority-v1",
    projection: PROJECTION.kind,
    profile: profile.profile,
    seed: profile.seed,
    unitsPerTile: profile.unitsPerTile,
    blockers,
    resourceNodes,
    decayConsumers,
  };
}

function detailMetadata(tile, profile, kind, seed) {
  if (kind !== "tree") {
    if (kind === "boulder") {
      const amount = 1 + Math.floor(hash01(tile.x, tile.y, profile.seed + seed + 73) * 4);
      return {
        resources: [{ kind: "ore", amount, maxAmount: 4 }],
        lifecycle: { stage: "mineral", decay: 0, growth: 0 },
      };
    }
    if (kind === "ruin") {
      const ageYears = 42000 + Math.floor(hash01(tile.x, tile.y, profile.seed + seed + 74) * 110000);
      const decay = 0.48 + hash01(tile.x, tile.y, profile.seed + seed + 76) * 0.42;
      const amount = 1 + Math.floor((1 - decay * 0.55) * 5);
      return {
        resources: [{ kind: "stone", amount, maxAmount: 6 }],
        lifecycle: {
          family: "mineral",
          stage: "ancient-ruin",
          species: "weathered-viaduct-stone",
          ageYears,
          health: clamp(1 - decay * 0.86, 0.08, 0.48),
          decay,
          growth: 0,
        },
        occlusion: {
          heightTiles: 0.72,
          radiusTiles: 0.82,
          fadeAlpha: 0.54,
        },
      };
    }
    if (kind === "wall" || kind === "stairs" || kind === "foundation") {
      const ageYears = 70000 + Math.floor(hash01(tile.x, tile.y, profile.seed + seed + 78) * 90000);
      const decay = kind === "foundation" ? 0.55 + hash01(tile.x, tile.y, profile.seed + seed + 82) * 0.35 : 0.42 + hash01(tile.x, tile.y, profile.seed + seed + 82) * 0.44;
      const amount = kind === "wall" ? 3 : kind === "stairs" ? 2 : 1;
      return {
        resources: [{ kind: "stone", amount, maxAmount: kind === "wall" ? 8 : 5 }],
        lifecycle: {
          family: "mineral",
          stage: kind === "stairs" ? "eroded-stairs" : kind === "foundation" ? "sunken-foundation" : "broken-wall",
          species: "weathered-courtyard-stone",
          ageYears,
          health: clamp(1 - decay * 0.78, 0.1, 0.54),
          decay,
          growth: 0,
        },
        vertical: kind === "wall" ? 1.4 : kind === "stairs" ? 0.7 : 0.18,
        occlusion:
          kind === "wall"
            ? { heightTiles: 1.28, radiusTiles: 0.72, fadeAlpha: 0.42 }
            : kind === "stairs"
              ? { heightTiles: 0.54, radiusTiles: 0.68, fadeAlpha: 0.62 }
              : { heightTiles: 0.18, radiusTiles: 0.54, fadeAlpha: 0.78 },
        sortBias: kind === "wall" ? 16 : kind === "stairs" ? 6 : -2,
      };
    }
    if (kind === "reeds") {
      const amount = 1 + Math.floor(hash01(tile.x, tile.y, profile.seed + seed + 79) * 3);
      return {
        resources: [{ kind: "fiber", amount, maxAmount: 3 }],
        lifecycle: { stage: "living", decay: 0, growth: 0.72 },
      };
    }
    if (kind === "fallen-log" || kind === "stump") {
      const decay = hash01(tile.x, tile.y, profile.seed + seed + 89);
      const amount = 1 + Math.floor((1 - decay * 0.48) * 3);
      return {
        lifecycle: { stage: decay > 0.62 ? "decaying" : "deadwood", decay, growth: 0 },
        resources: [
          { kind: "deadwood", amount, maxAmount: 4 },
          ...(decay > 0.58 ? [{ kind: "spores", amount: 1, maxAmount: 2 }] : []),
        ],
      };
    }
    if (kind === "mushroom") {
      const decay = 0.45 + hash01(tile.x, tile.y, profile.seed + seed + 97) * 0.55;
      const amount = 1 + Math.floor(decay * 3);
      return {
        lifecycle: { stage: "fruiting", decay, growth: decay },
        consumes: [{ kind: "deadwood", amount: 1 }],
        resources: [{ kind: "mycelium", amount, maxAmount: 4 }],
      };
    }
    return {};
  }

  const stageRoll = hash01(tile.x, tile.y, profile.seed + seed + 67);
  const stage = stageRoll < 0.28 ? "sapling" : stageRoll < 0.62 ? "mature" : "ancient";
  const variant = Math.floor(hash01(tile.x, tile.y, profile.seed + seed + 71) * 4);
  const species = ["greenwood", "shadebark", "ironleaf", "paleoak"][variant] ?? "greenwood";
  const vigor = hash01(tile.x, tile.y, profile.seed + seed + 75);
  const ageYears = treeAgeYears(stage, vigor, hash01(tile.x, tile.y, profile.seed + seed + 77));
  const decay = treeDecayFor(stage, species, vigor, hash01(tile.x, tile.y, profile.seed + seed + 81));
  const health = clamp(1 - decay * 0.7 + (vigor - 0.5) * 0.16, 0.18, 1);
  const stageConfig = {
    sapling: { min: 1, max: 3, scale: [0.72, 0.78, 0.68, 0.74][variant] },
    mature: { min: 4, max: 9, scale: [1, 1.06, 0.94, 1.02][variant] },
    ancient: { min: 8, max: 14, scale: [1.15, 1.2, 1.08, 1.16][variant] },
  }[stage];
  const resourceRoll = hash01(tile.x, tile.y, profile.seed + seed + 83);
  const healthAdjustedMax = Math.max(stageConfig.min, Math.round(stageConfig.max * (0.58 + health * 0.42)));
  const amount = clampInteger(
    stageConfig.min + Math.floor(resourceRoll * (healthAdjustedMax - stageConfig.min + 1)),
    1,
    stageConfig.max,
  );
  const seedAmount =
    health > 0.42 && (stage === "ancient" || (stage === "mature" && resourceRoll > 0.58) || (stage === "sapling" && vigor > 0.92))
      ? 1
      : 0;
  return {
    stage,
    variant,
    species,
    ageYears,
    health,
    scaleMultiplier: stageConfig.scale,
    lifecycle: {
      stage,
      species,
      ageYears,
      health,
      decay,
      growth: stage === "sapling" ? 0.28 : stage === "mature" ? 0.72 : 1,
    },
    resources: [
      {
        kind: "wood",
        amount,
        maxAmount: stageConfig.max,
      },
      ...(seedAmount > 0 ? [{ kind: "seed", amount: seedAmount, maxAmount: 1 }] : []),
    ],
  };
}

function treeAgeYears(stage, vigor, roll) {
  const ranges = {
    sapling: [2, 11],
    mature: [18, 76],
    ancient: [95, 260],
  }[stage];
  return Math.round(ranges[0] + (ranges[1] - ranges[0]) * (roll * 0.74 + vigor * 0.26));
}

function treeDecayFor(stage, species, vigor, roll) {
  const ageBias = stage === "ancient" ? 0.2 : stage === "mature" ? 0.08 : 0.02;
  const speciesBias = species === "ironleaf" ? 0.1 : species === "paleoak" ? 0.06 : 0;
  return clamp(ageBias + speciesBias + roll * (1 - vigor) * 0.42, 0, stage === "sapling" ? 0.24 : 0.72);
}

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function detailFootprint(kind) {
  const footprints = {
    tree: { widthTiles: 1.18, heightTiles: 1.04, reserveRadiusTiles: 2, blocksMovement: true },
    ruin: { widthTiles: 1.35, heightTiles: 1.1, reserveRadiusTiles: 1, blocksMovement: true },
    wall: { widthTiles: 1.16, heightTiles: 0.52, reserveRadiusTiles: 0, blocksMovement: true },
    stairs: { widthTiles: 1.1, heightTiles: 0.82, reserveRadiusTiles: 0, blocksMovement: false },
    foundation: { widthTiles: 0.92, heightTiles: 0.7, reserveRadiusTiles: 0, blocksMovement: false },
    boulder: { widthTiles: 0.86, heightTiles: 0.72, reserveRadiusTiles: 1, blocksMovement: true },
    reeds: { widthTiles: 0.58, heightTiles: 0.38, reserveRadiusTiles: 1, blocksMovement: false },
    rock: { widthTiles: 0.58, heightTiles: 0.46, reserveRadiusTiles: 0, blocksMovement: false },
    "fallen-log": { widthTiles: 0.94, heightTiles: 0.36, reserveRadiusTiles: 0, blocksMovement: false },
    stump: { widthTiles: 0.46, heightTiles: 0.36, reserveRadiusTiles: 0, blocksMovement: false },
  };
  return footprints[kind] ?? { widthTiles: 0.28, heightTiles: 0.22, reserveRadiusTiles: 0, blocksMovement: false };
}

function reserveDetailFootprint(tile, radius, occupiedFootprints, cols, rows) {
  for (let y = tile.y - radius; y <= tile.y + radius; y += 1) {
    for (let x = tile.x - radius; x <= tile.x + radius; x += 1) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
      if (occupiedFootprints.has(`${x}:${y}`)) return false;
    }
  }
  for (let y = tile.y - radius; y <= tile.y + radius; y += 1) {
    for (let x = tile.x - radius; x <= tile.x + radius; x += 1) {
      occupiedFootprints.add(`${x}:${y}`);
    }
  }
  return true;
}

function materialPriority(material) {
  return MATERIAL_PRIORITY.indexOf(material);
}

export function terrainHeightMetadata(heights) {
  const values = [heights.nw, heights.ne, heights.se, heights.sw];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const north = (heights.nw + heights.ne) / 2;
  const south = (heights.sw + heights.se) / 2;
  const east = (heights.ne + heights.se) / 2;
  const west = (heights.nw + heights.sw) / 2;
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

function chunkHeightMetadata(tiles) {
  const min = Math.min(...tiles.map((tile) => tile.height.min));
  const max = Math.max(...tiles.map((tile) => tile.height.max));
  const average = tiles.reduce((sum, tile) => sum + tile.height.average, 0) / Math.max(1, tiles.length);
  return {
    min,
    max,
    average,
    range: max - min,
  };
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

function bilerp(nw, ne, sw, se, fx, fy) {
  const north = nw * (1 - fx) + ne * fx;
  const south = sw * (1 - fx) + se * fx;
  return north * (1 - fy) + south * fy;
}

function terrainProfile(map) {
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

function defaultTerrainProfile() {
  return {
    profile: "duskfell-terrain-v1",
    seed: 7341,
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

function noise2d(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  return bilerp(
    hashUnit(x0, y0, seed + 3),
    hashUnit(x0 + 1, y0, seed + 3),
    hashUnit(x0, y0 + 1, seed + 3),
    hashUnit(x0 + 1, y0 + 1, seed + 3),
    fx,
    fy,
  );
}

function hashUnit(x, y, seed) {
  let value = Math.imul(x + 101, 374761393) ^ Math.imul(y + 181, 668265263) ^ Math.imul(seed + 31, 2147483647);
  value = (value ^ (value >>> 13)) >>> 0;
  value = Math.imul(value, 1274126177) >>> 0;
  return (((value ^ (value >>> 16)) >>> 0) / 0xffffffff) * 2 - 1;
}

function hash01(x, y, seed) {
  return (hashUnit(x, y, seed) + 1) / 2;
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
