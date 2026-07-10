import { PROJECTION } from "./projection.js";
import { TERRAIN_MATERIALS } from "./terrain.js";
import { VISUAL_BIOMES } from "./terrain-visual-biomes.js";

const OVERLAY_PATCHES = ["trail"];

const MANIFEST_SCHEMA_VERSION = "duskfell-terrain-atlas-v1";
const ALLOWED_TILE_KINDS = new Set(["flat-base", "slope-texture", "transition", "pair-transition", "decal"]);
const EDGE_MASKS = new Set(["north", "east", "south", "west"]);
const CORNER_MASKS = new Set(["northEast", "southEast", "southWest", "northWest"]);

export function normalizeTerrainAtlas(manifest) {
  if (!isObject(manifest)) {
    throw new Error("terrain atlas manifest must be an object");
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`terrain atlas schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`);
  }
  validateProjection(manifest.projection);
  validateTileSheet(manifest.tileSheet);
  if (!Array.isArray(manifest.tiles) || manifest.tiles.length === 0) {
    throw new Error("terrain atlas tiles must be a non-empty array");
  }

  const byMaterial = new Map();
  const slopeByMaterial = new Map();
  const transitionByMaterial = new Map();
  const transitionByMaterialAndMask = new Map();
  const pairTransitionByPair = new Map();
  const pairTransitionByPairAndMask = new Map();
  const normalizedTiles = [];
  for (const tile of manifest.tiles) {
    const normalized = normalizeTile(tile, manifest.tileSheet);
    if (normalized.kind === "flat-base") {
      byMaterial.set(normalized.material, normalized);
    } else if (normalized.kind === "slope-texture") {
      slopeByMaterial.set(normalized.material, normalized);
    } else if (normalized.kind === "transition") {
      if (normalized.mask) {
        transitionByMaterialAndMask.set(transitionMaskKey(normalized.material, normalized.mask), normalized);
      } else if (!transitionByMaterial.has(normalized.material)) {
        transitionByMaterial.set(normalized.material, normalized);
      }
    } else if (normalized.kind === "pair-transition") {
      if (normalized.mask) {
        pairTransitionByPairAndMask.set(transitionPairMaskKey(normalized.pair.from, normalized.pair.to, normalized.mask), normalized);
      } else {
        pairTransitionByPair.set(transitionPairKey(normalized.pair.from, normalized.pair.to), normalized);
      }
    }
    normalizedTiles.push(normalized);
  }
  const groundPatches = normalizeGroundPatches(manifest.groundPatches);

  for (const material of Object.keys(TERRAIN_MATERIALS)) {
    if (!byMaterial.has(material)) {
      throw new Error(`terrain atlas missing flat-base tile for material ${material}`);
    }
    if (!slopeByMaterial.has(material)) {
      throw new Error(`terrain atlas missing slope-texture tile for material ${material}`);
    }
    if (!transitionByMaterial.has(material)) {
      throw new Error(`terrain atlas missing transition tile for material ${material}`);
    }
    for (const edge of EDGE_MASKS) {
      const mask = { type: "edge", edge };
      if (!transitionByMaterialAndMask.has(transitionMaskKey(material, mask))) {
        throw new Error(`terrain atlas missing ${edge} transition tile for material ${material}`);
      }
    }
    for (const corner of CORNER_MASKS) {
      const mask = { type: "corner", corner };
      if (!transitionByMaterialAndMask.has(transitionMaskKey(material, mask))) {
        throw new Error(`terrain atlas missing ${corner} transition tile for material ${material}`);
      }
    }
  }

  return {
    tileSheet: {
      id: manifest.tileSheet.id,
      imagePath: manifest.tileSheet.image,
      sha256: manifest.tileSheet.sha256,
      cellWidth: manifest.tileSheet.cellWidth,
      cellHeight: manifest.tileSheet.cellHeight,
      columns: manifest.tileSheet.columns,
      rows: manifest.tileSheet.rows,
      frameCount: manifest.tileSheet.frameCount,
    },
    tiles: normalizedTiles,
    byMaterial,
    slopeByMaterial,
    transitionByMaterial,
    transitionByMaterialAndMask,
    pairTransitionByPair,
    pairTransitionByPairAndMask,
    groundPatches,
  };
}

function normalizeGroundPatches(patches) {
  if (patches == null) return [];
  if (!Array.isArray(patches)) {
    throw new Error("terrain atlas groundPatches must be an array");
  }
  const seenBiomes = new Set();
  const normalized = patches.map((patch, index) => {
    if (!isObject(patch)) throw new Error(`terrain atlas groundPatches[${index}] must be an object`);
    if (!isNonEmptyString(patch.id)) throw new Error(`terrain atlas groundPatches[${index}].id must be non-empty`);
    // overlay paintings (trail wear) ride alongside the biome set
    if (!VISUAL_BIOMES.includes(patch.biome) && !OVERLAY_PATCHES.includes(patch.biome)) {
      throw new Error(`terrain atlas groundPatches[${index}].biome is unsupported`);
    }
    if (seenBiomes.has(patch.biome)) {
      throw new Error(`terrain atlas groundPatches biome ${patch.biome} is duplicated`);
    }
    seenBiomes.add(patch.biome);
    if (!isSafeRelativeImage(patch.image)) {
      throw new Error(`terrain atlas groundPatches[${index}].image must be a safe relative PNG or WebP path`);
    }
    if (typeof patch.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(patch.sha256)) {
      throw new Error(`terrain atlas groundPatches[${index}].sha256 must be a lowercase SHA-256 hex digest`);
    }
    if (!isPositiveInteger(patch.width) || !isPositiveInteger(patch.height)) {
      throw new Error(`terrain atlas groundPatches[${index}] dimensions must be positive integers`);
    }
    return {
      id: patch.id,
      biome: patch.biome,
      imagePath: patch.image,
      sha256: patch.sha256,
      width: patch.width,
      height: patch.height,
    };
  });
  if (normalized.length > 0) {
    for (const biome of VISUAL_BIOMES) {
      if (!seenBiomes.has(biome)) throw new Error(`terrain atlas missing ground patch for biome ${biome}`);
    }
  }
  return normalized;
}

export function transitionMaskKey(material, mask) {
  if (mask?.type === "edge") return `${material}:edge:${mask.edge}`;
  if (mask?.type === "corner") return `${material}:corner:${mask.corner}`;
  return `${material}:generic`;
}

export function transitionPairKey(from, to) {
  return `${from}->${to}`;
}

export function transitionPairMaskKey(from, to, mask) {
  if (mask?.type === "edge") return `${transitionPairKey(from, to)}:edge:${mask.edge}`;
  if (mask?.type === "corner") return `${transitionPairKey(from, to)}:corner:${mask.corner}`;
  return `${transitionPairKey(from, to)}:generic`;
}

function validateProjection(projection) {
  if (!isObject(projection)) {
    throw new Error("terrain atlas projection must be an object");
  }
  if (
    projection.kind !== PROJECTION.kind ||
    projection.tileWidth !== PROJECTION.tileW ||
    projection.tileHeight !== PROJECTION.tileH ||
    projection.tileAspectRatio !== PROJECTION.tileAspectRatio ||
    projection.axisAngleDegrees !== PROJECTION.axisAngleDegrees ||
    projection.heightAxis !== PROJECTION.heightAxis ||
    projection.unitsPerTile !== PROJECTION.unitsPerTile
  ) {
    throw new Error("terrain atlas projection does not match the client projection");
  }
}

function validateTileSheet(sheet) {
  if (!isObject(sheet)) {
    throw new Error("terrain atlas tileSheet must be an object");
  }
  if (!isNonEmptyString(sheet.id)) {
    throw new Error("terrain atlas tileSheet.id must be a non-empty string");
  }
  if (!isSafeRelativePng(sheet.image)) {
    throw new Error("terrain atlas tileSheet.image must be a safe relative PNG path");
  }
  if (typeof sheet.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sheet.sha256)) {
    throw new Error("terrain atlas tileSheet.sha256 must be a lowercase SHA-256 hex digest");
  }
  for (const key of ["cellWidth", "cellHeight", "columns", "rows", "frameCount"]) {
    if (!isPositiveInteger(sheet[key])) {
      throw new Error(`terrain atlas tileSheet.${key} must be a positive integer`);
    }
  }
  if (sheet.cellWidth !== PROJECTION.tileW || sheet.cellHeight !== PROJECTION.tileH) {
    throw new Error("terrain atlas cells must match the 64x64 terrain projection tile size");
  }
  if (sheet.frameCount > sheet.columns * sheet.rows) {
    throw new Error("terrain atlas tileSheet.frameCount exceeds grid capacity");
  }
}

function normalizeTile(tile, sheet) {
  if (!isObject(tile)) {
    throw new Error("terrain atlas tile entries must be objects");
  }
  if (!Object.hasOwn(TERRAIN_MATERIALS, tile.material)) {
    throw new Error(`terrain atlas tile material ${JSON.stringify(tile.material)} is unsupported`);
  }
  if (!ALLOWED_TILE_KINDS.has(tile.kind)) {
    throw new Error(`terrain atlas tile kind for ${tile.material} is unsupported`);
  }
  if (!Number.isInteger(tile.frame) || tile.frame < 0 || tile.frame >= sheet.frameCount) {
    throw new Error(`terrain atlas tile frame for ${tile.material} is outside tileSheet range`);
  }
  if (!isObject(tile.surface)) {
    throw new Error(`terrain atlas tile surface for ${tile.material} must be an object`);
  }
  if (typeof tile.surface.walkable !== "boolean") {
    throw new Error(`terrain atlas tile surface.walkable for ${tile.material} must be boolean`);
  }
  if (tile.material === "water" && tile.surface.walkable !== false) {
    throw new Error("terrain atlas water surface must not be walkable");
  }
  const pair = normalizeTransitionPair(tile);
  const mask = normalizeTransitionMask(tile);

  return {
    id: tile.id,
    material: tile.material,
    kind: tile.kind,
    frame: tile.frame,
    pair,
    mask,
    surface: {
      walkable: tile.surface.walkable,
      role: isNonEmptyString(tile.surface.role) ? tile.surface.role : "ground",
    },
  };
}

function normalizeTransitionPair(tile) {
  if (tile.pair == null) {
    if (tile.kind === "pair-transition") {
      throw new Error(`terrain atlas pair-transition tile for ${tile.material} must declare pair`);
    }
    return null;
  }
  if (tile.kind !== "pair-transition") {
    throw new Error(`terrain atlas tile pair for ${tile.material} is only supported on pair-transition tiles`);
  }
  if (!isObject(tile.pair)) {
    throw new Error(`terrain atlas pair-transition pair for ${tile.material} must be an object`);
  }
  if (!Object.hasOwn(TERRAIN_MATERIALS, tile.pair.from)) {
    throw new Error(`terrain atlas pair-transition from material ${JSON.stringify(tile.pair.from)} is unsupported`);
  }
  if (!Object.hasOwn(TERRAIN_MATERIALS, tile.pair.to)) {
    throw new Error(`terrain atlas pair-transition to material ${JSON.stringify(tile.pair.to)} is unsupported`);
  }
  if (tile.pair.to !== tile.material) {
    throw new Error(`terrain atlas pair-transition material must match pair.to for ${tile.material}`);
  }
  if (tile.pair.from === tile.pair.to) {
    throw new Error(`terrain atlas pair-transition for ${tile.material} must use different materials`);
  }
  return {
    from: tile.pair.from,
    to: tile.pair.to,
  };
}

function normalizeTransitionMask(tile) {
  if (tile.mask == null) return null;
  if (tile.kind !== "transition" && tile.kind !== "pair-transition") {
    throw new Error(`terrain atlas tile mask for ${tile.material} is only supported on transition tiles`);
  }
  if (!isObject(tile.mask)) {
    throw new Error(`terrain atlas transition mask for ${tile.material} must be an object`);
  }
  if (tile.mask.type === "edge") {
    if (!EDGE_MASKS.has(tile.mask.edge)) {
      throw new Error(`terrain atlas transition edge for ${tile.material} is unsupported`);
    }
    return {
      type: "edge",
      edge: tile.mask.edge,
    };
  }
  if (tile.mask.type === "corner") {
    if (!CORNER_MASKS.has(tile.mask.corner)) {
      throw new Error(`terrain atlas transition corner for ${tile.material} is unsupported`);
    }
    return {
      type: "corner",
      corner: tile.mask.corner,
    };
  }
  throw new Error(`terrain atlas transition mask type for ${tile.material} is unsupported`);
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isSafeRelativePng(value) {
  return (
    isNonEmptyString(value) &&
    !value.startsWith("/") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(value) &&
    !value.split(/[\\/]+/).includes("..") &&
    value.toLowerCase().endsWith(".png")
  );
}

function isSafeRelativeImage(value) {
  return (
    isNonEmptyString(value) &&
    !value.startsWith("/") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(value) &&
    !value.split(/[\\/]+/).includes("..") &&
    /\.(png|webp)$/i.test(value)
  );
}
