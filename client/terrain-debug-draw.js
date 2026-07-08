import { PROJECTION } from "./projection.js";
import { terrainWalkabilityAtWorld } from "./terrain.js";

const TERRAIN_DEBUG_MODES = new Set([
  "authority",
  "biome",
  "chunks",
  "detail",
  "elevation",
  "kit",
  "material",
  "moisture",
  "path",
  "rock",
  "transition",
  "vegetation",
  "walkability",
  "zone",
]);

export function normalizeTerrainDebugMode(value) {
  if (!value) return "";
  const normalized = String(value).trim().toLowerCase();
  return TERRAIN_DEBUG_MODES.has(normalized) ? normalized : "";
}

export function createTerrainDebugDrawer({ getContext, getTerrain }) {
  function drawTerrainDebugChunk(chunk, mode) {
    if (mode !== "chunks") return;
    const ctx = getContext();
    ctx.save();
    ctx.strokeStyle = "rgba(255, 244, 189, 0.72)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(
      chunk.bounds.minX,
      chunk.bounds.minY,
      chunk.bounds.maxX - chunk.bounds.minX,
      chunk.bounds.maxY - chunk.bounds.minY,
    );
    ctx.restore();
  }

  function drawTerrainDebugTile(tile, corners, mode) {
    if (!mode || mode === "chunks") return;
    const fill = terrainDebugFill(tile, mode);
    if (!fill) return;

    const ctx = getContext();
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(corners.nw.x, corners.nw.y);
    ctx.lineTo(corners.ne.x, corners.ne.y);
    ctx.lineTo(corners.se.x, corners.se.y);
    ctx.lineTo(corners.sw.x, corners.sw.y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = "rgba(13, 17, 16, 0.18)";
    ctx.lineWidth = 0.45;
    ctx.stroke();
    ctx.restore();
  }

  function terrainDebugFill(tile, mode) {
    const biome = tile.biome ?? {};
    if (mode === "material") return materialDebugFill(tile.material);
    if (mode === "biome") {
      return `rgba(${Math.round((biome.rockiness ?? 0) * 255)}, ${Math.round((biome.vegetation ?? 0) * 220)}, ${Math.round((biome.moisture ?? 0) * 255)}, 0.42)`;
    }
    if (mode === "elevation") return debugRamp(biome.elevation ?? 0, 220, 238, 154);
    if (mode === "moisture") return debugRamp(biome.moisture ?? 0, 81, 173, 202);
    if (mode === "rock") return debugRamp(biome.rockiness ?? 0, 192, 190, 174);
    if (mode === "vegetation") return debugRamp(biome.vegetation ?? 0, 86, 175, 85);
    if (mode === "zone") return compositionDebugFill(tile.composition?.zone);
    if (mode === "kit") return compositionKitDebugFill(tile.composition?.kitRole, tile.composition?.kitKind);
    if (mode === "authority") return terrainAuthorityDebugFill(tile);
    if (mode === "path") return debugRamp(Math.max(biome.pathPressure ?? 0, biome.plazaPressure ?? 0), 231, 185, 108);
    if (mode === "detail") return debugRamp(biome.detailDensity ?? 0, 255, 215, 128);
    if (mode === "transition") return transitionDebugFill(tile);
    if (mode === "walkability") return walkabilityDebugFill(tile);
    return null;
  }

  function terrainAuthorityDebugFill(tile) {
    const terrain = getTerrain();
    const authority = terrain?.detailAuthority;
    if (!authority) return null;
    const tileMatches = (entry) => entry.tile?.x === tile.x && entry.tile?.y === tile.y;
    if (authority.blockers?.some(tileMatches)) return "rgba(218, 66, 56, 0.58)";
    if (authority.decayConsumers?.some(tileMatches)) return "rgba(161, 111, 211, 0.52)";
    if (authority.resourceNodes?.some(tileMatches)) return "rgba(75, 176, 95, 0.46)";
    return null;
  }

  function walkabilityDebugFill(tile) {
    const terrain = getTerrain();
    if (!terrain) return null;
    const units = terrain.profile?.unitsPerTile ?? PROJECTION.unitsPerTile;
    const result = terrainWalkabilityAtWorld(terrain, (tile.x + 0.5) * units, (tile.y + 0.5) * units);
    if (result.reason === "water") return "rgba(53, 132, 190, 0.52)";
    if (result.reason === "blocked-detail") return "rgba(213, 70, 58, 0.56)";
    if (result.reason === "steep") return "rgba(225, 169, 67, 0.54)";
    if (result.walkable) return "rgba(73, 173, 93, 0.28)";
    return "rgba(191, 77, 118, 0.44)";
  }

  return {
    drawTerrainDebugChunk,
    drawTerrainDebugTile,
  };
}

function compositionDebugFill(zone) {
  const colors = {
    grove: "rgba(56, 140, 73, 0.46)",
    meadow: "rgba(117, 170, 83, 0.34)",
    plaza: "rgba(229, 206, 151, 0.48)",
    ridge: "rgba(172, 173, 161, 0.5)",
    road: "rgba(191, 132, 76, 0.48)",
    scrub: "rgba(156, 118, 77, 0.42)",
    shore: "rgba(120, 166, 143, 0.46)",
    water: "rgba(59, 144, 190, 0.5)",
  };
  return colors[zone] ?? null;
}

function compositionKitDebugFill(role, kind) {
  if (!kind || role === "none") return null;
  const colors = {
    causeway: "rgba(212, 210, 184, 0.62)",
    rubble: "rgba(153, 148, 128, 0.48)",
    "wall-north": "rgba(188, 181, 156, 0.58)",
    "wall-south": "rgba(150, 139, 115, 0.54)",
    "wall-west": "rgba(168, 160, 136, 0.52)",
    "wall-east": "rgba(168, 160, 136, 0.52)",
    stairs: "rgba(206, 196, 164, 0.56)",
    "courtyard-floor": "rgba(184, 176, 146, 0.42)",
    "courtyard-rubble": "rgba(129, 122, 103, 0.42)",
    plaza: "rgba(236, 210, 154, 0.46)",
    road: "rgba(202, 145, 84, 0.44)",
    threshold: "rgba(178, 151, 105, 0.34)",
    canopy: "rgba(57, 143, 74, 0.44)",
    understory: "rgba(70, 119, 64, 0.32)",
    reedline: "rgba(92, 152, 126, 0.46)",
    "wet-edge": "rgba(79, 134, 130, 0.32)",
  };
  return colors[role] ?? "rgba(214, 190, 132, 0.36)";
}

function transitionDebugFill(tile) {
  const edgeCount = tile.transitions.filter((transition) => transition.type === "edge").length;
  const cornerCount = tile.transitions.filter((transition) => transition.type === "corner").length;
  if (edgeCount + cornerCount === 0) return null;
  const red = Math.min(255, 80 + edgeCount * 44);
  const blue = Math.min(255, 96 + cornerCount * 58);
  return `rgba(${red}, 176, ${blue}, ${Math.min(0.62, 0.18 + (edgeCount + cornerCount) * 0.1)})`;
}

function materialDebugFill(material) {
  const colors = {
    dirt: "rgba(169, 105, 66, 0.42)",
    field: "rgba(185, 176, 96, 0.42)",
    grass: "rgba(78, 156, 74, 0.42)",
    settlement: "rgba(232, 218, 176, 0.46)",
    stone: "rgba(160, 166, 158, 0.46)",
    water: "rgba(64, 154, 199, 0.48)",
  };
  return colors[material] ?? "rgba(255, 255, 255, 0.25)";
}

function debugRamp(value, r, g, b) {
  const alpha = 0.08 + clamp(value, 0, 1) * 0.52;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
