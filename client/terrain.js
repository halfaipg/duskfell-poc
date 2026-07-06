import { PROJECTION, projectMap } from "./projection.js";

export const TERRAIN_MATERIALS = {
  grass: {
    fill: "#6f8f57",
    light: "#8fa66b",
    dark: "#4d6d45",
    stroke: "rgba(32, 48, 37, 0.18)",
    transition: "#4f744f",
  },
  field: {
    fill: "#c8b77d",
    light: "#dfcd95",
    dark: "#9f875a",
    stroke: "rgba(78, 66, 43, 0.16)",
    transition: "#b59b68",
  },
  dirt: {
    fill: "#9b7655",
    light: "#bc936d",
    dark: "#6e533e",
    stroke: "rgba(57, 42, 30, 0.2)",
    transition: "#7d5f45",
  },
  stone: {
    fill: "#858480",
    light: "#a8a6a0",
    dark: "#5c5d5c",
    stroke: "rgba(42, 45, 45, 0.22)",
    transition: "#6b6d6b",
  },
  water: {
    fill: "#4e8fa0",
    light: "#79bac5",
    dark: "#2f6476",
    stroke: "rgba(21, 67, 82, 0.24)",
    transition: "#d4c083",
  },
  settlement: {
    fill: "#d5cab0",
    light: "#eee2c7",
    dark: "#a99c82",
    stroke: "rgba(94, 81, 61, 0.18)",
    transition: "#b9aa8a",
  },
};

const MATERIAL_PRIORITY = ["water", "stone", "dirt", "settlement", "field", "grass"];

export function buildTerrain(map) {
  const profile = terrainProfile(map);
  const cols = Math.ceil(map.width / profile.unitsPerTile);
  const rows = Math.ceil(map.height / profile.unitsPerTile);
  const safeRadiusTiles = map.safeZoneRadius / profile.unitsPerTile;
  const tiles = [];

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const material = materialForTile(x, y, cols, rows, safeRadiusTiles, profile);
      const heights = cornerHeights(x, y, cols, rows, safeRadiusTiles, material, profile);
      tiles.push({
        x,
        y,
        material,
        heights,
        sloped: new Set(Object.values(heights)).size > 1,
        transitions: transitionsForTile(x, y, material, cols, rows, safeRadiusTiles, profile),
        decals: decalsForTile(x, y, material, profile),
      });
    }
  }

  return {
    cols,
    rows,
    width: map.width,
    height: map.height,
    safeRadiusTiles,
    profile,
    tiles,
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

  const heights = tile.heights;
  const slopeY = (heights.sw + heights.se - heights.nw - heights.ne) / 2;
  const slopeX = (heights.ne + heights.se - heights.nw - heights.sw) / 2;
  const range = Math.max(...Object.values(heights)) - Math.min(...Object.values(heights));
  const alpha = clamp(0.2 + range * 0.055, 0.2, 0.48);

  return [
    {
      name: "right",
      corners: ["nw", "ne", "se"],
      shade: clamp(slopeX * 0.1 - slopeY * 0.08 - 0.05, -0.36, 0.32),
      alpha,
    },
    {
      name: "left",
      corners: ["nw", "se", "sw"],
      shade: clamp(slopeY * 0.1 - slopeX * 0.08 + 0.06, -0.34, 0.36),
      alpha: alpha * 0.9,
    },
  ];
}

export function materialForTile(x, y, cols, rows, safeRadiusTiles, profile = defaultTerrainProfile()) {
  const riverCenter = rows * 0.66 - Math.sin(x / 3.2) * 2.2 + Math.cos(x / 5.4) * 1.2;
  const riverDistance = Math.abs(y - riverCenter);
  if (riverDistance < 0.9) return "water";
  if (riverDistance < 1.75) return "dirt";

  const centerDistance = Math.hypot(x + 0.5 - cols / 2, y + 0.5 - rows / 2);
  if (centerDistance < safeRadiusTiles * 0.72) return "settlement";

  const grain = noise2d(x, y, profile.seed);
  const ridge = Math.sin((x + y) * 0.34) + Math.cos((x - y) * 0.41);
  if (grain > 0.72 || ridge > 1.25) return "stone";
  if (grain < -0.36 || riverDistance < 2.4) return "grass";
  return "field";
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

function transitionsForTile(x, y, material, cols, rows, safeRadiusTiles, profile) {
  const edges = [
    ["north", x, y - 1],
    ["east", x + 1, y],
    ["south", x, y + 1],
    ["west", x - 1, y],
  ];
  const transitions = [];

  for (const [edge, nx, ny] of edges) {
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const nextMaterial = materialForTile(nx, ny, cols, rows, safeRadiusTiles, profile);
    if (nextMaterial === material) continue;
    if (materialPriority(nextMaterial) < materialPriority(material)) continue;
    transitions.push({
      edge,
      to: nextMaterial,
      color: TERRAIN_MATERIALS[nextMaterial].transition,
    });
  }
  return transitions;
}

function decalsForTile(x, y, material, profile) {
  if (material === "water" || material === "settlement") return [];
  const amount = Math.abs(hashUnit(x, y, profile.seed + 17)) > 0.62 ? 2 : 1;
  const decals = [];
  for (let index = 0; index < amount; index += 1) {
    const seed = index + 1;
    const u = 0.22 + Math.abs(hashUnit(x, y, profile.seed + seed)) * 0.56;
    const v = 0.2 + Math.abs(hashUnit(x, y, profile.seed + seed + 11)) * 0.58;
    const variant = hashUnit(x, y, profile.seed + seed + 23);
    decals.push({
      kind: material === "stone" || variant > 0.48 ? "pebble" : "tuft",
      u,
      v,
      size: 2 + Math.floor(Math.abs(hashUnit(x, y, profile.seed + seed + 31)) * 4),
    });
  }
  return decals;
}

function materialPriority(material) {
  return MATERIAL_PRIORITY.indexOf(material);
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
  return hashUnit(Math.floor(x * 17), Math.floor(y * 17), seed + 3);
}

function hashUnit(x, y, seed) {
  let value = Math.imul(x + 101, 374761393) ^ Math.imul(y + 181, 668265263) ^ Math.imul(seed + 31, 2147483647);
  value = (value ^ (value >>> 13)) >>> 0;
  value = Math.imul(value, 1274126177) >>> 0;
  return ((value ^ (value >>> 16)) / 0xffffffff) * 2 - 1;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
