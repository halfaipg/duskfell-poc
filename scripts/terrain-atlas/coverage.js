import { TERRAIN_MATERIALS } from "../../client/terrain.js";
import { CORNER_MASKS, EDGE_MASKS } from "./constants.js";
import { isObject, isNonEmptyString } from "./validators.js";

export function validateTileCoverage(tiles, errors, warnings) {
  void warnings;
  if (!Array.isArray(tiles)) return;

  const seenBaseMaterials = new Set();
  const seenSlopeMaterials = new Set();
  const seenTransitionMaterials = new Set();
  const seenTransitionMasks = new Set();
  const seenPairTransitions = new Set();
  const seenIds = new Set();
  for (const [index, tile] of tiles.entries()) {
    const prefix = `tiles[${index}]`;
    if (!isObject(tile)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!isNonEmptyString(tile.id)) {
      errors.push(`${prefix}.id must be a non-empty string`);
    } else if (seenIds.has(tile.id)) {
      errors.push(`${prefix}.id ${JSON.stringify(tile.id)} is duplicated`);
    } else {
      seenIds.add(tile.id);
    }
    if (tile.kind === "flat-base" && Object.hasOwn(TERRAIN_MATERIALS, tile.material)) {
      seenBaseMaterials.add(tile.material);
    } else if (tile.kind === "slope-texture" && Object.hasOwn(TERRAIN_MATERIALS, tile.material)) {
      seenSlopeMaterials.add(tile.material);
    } else if (tile.kind === "transition" && Object.hasOwn(TERRAIN_MATERIALS, tile.material)) {
      seenTransitionMaterials.add(tile.material);
      if (isObject(tile.mask)) {
        seenTransitionMasks.add(maskCoverageKey(tile.material, tile.mask));
      }
    } else if (tile.kind === "pair-transition") {
      validatePairTransition(tile, prefix, errors);
      if (isObject(tile.pair)) {
        seenPairTransitions.add(`${tile.pair.from}->${tile.pair.to}`);
      }
    }
  }

  for (const material of Object.keys(TERRAIN_MATERIALS)) {
    if (!seenBaseMaterials.has(material)) {
      errors.push(`missing flat-base terrain tile for ${material}`);
    }
    if (!seenSlopeMaterials.has(material)) {
      errors.push(`missing slope-texture terrain tile for ${material}`);
    }
    if (!seenTransitionMaterials.has(material)) {
      errors.push(`missing transition terrain tile for ${material}`);
    }
    for (const edge of EDGE_MASKS) {
      if (!seenTransitionMasks.has(`${material}:edge:${edge}`)) {
        errors.push(`missing ${edge} transition terrain tile for ${material}`);
      }
    }
    for (const corner of CORNER_MASKS) {
      if (!seenTransitionMasks.has(`${material}:corner:${corner}`)) {
        errors.push(`missing ${corner} transition terrain tile for ${material}`);
      }
    }
  }
}

function validatePairTransition(tile, prefix, errors) {
  if (!isObject(tile.pair)) {
    errors.push(`${prefix}.pair must be an object for pair-transition terrain tiles`);
    return;
  }
  if (!Object.hasOwn(TERRAIN_MATERIALS, tile.pair.from)) {
    errors.push(`${prefix}.pair.from is unsupported`);
  }
  if (!Object.hasOwn(TERRAIN_MATERIALS, tile.pair.to)) {
    errors.push(`${prefix}.pair.to is unsupported`);
  }
  if (tile.pair.to !== tile.material) {
    errors.push(`${prefix}.material must match pair.to`);
  }
}

function maskCoverageKey(material, mask) {
  if (mask.type === "edge") return `${material}:edge:${mask.edge}`;
  if (mask.type === "corner") return `${material}:corner:${mask.corner}`;
  return `${material}:unknown`;
}
