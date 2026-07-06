import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeTerrainAtlas } from "../client/terrain-assets.js";
import { PROJECTION } from "../client/projection.js";
import { TERRAIN_MATERIALS } from "../client/terrain.js";
import { readPngDimensions } from "./verify-sprite-manifest.js";

const DEFAULT_MANIFEST = "assets/terrain/manifest.json";
const TERRAIN_SCHEMA_VERSION = "duskfell-terrain-atlas-v1";
const ALLOWED_APPROVAL_STATES = new Set(["placeholder", "review", "approved", "rejected"]);
const DISALLOWED_CLEAN_ROOM_PROMPT_TERMS =
  /\b(ultima|uo|britain|moongate|broadsword|ea)\b/i;
const DISALLOWED_PROJECTION_PROMPT_TERMS =
  /\b(isometric|dimetric|64\s*x\s*32|128\s*x\s*64|2\s*:\s*1|rpg[-\s]?maker\s+iso|classic\s+iso)\b/i;
const DISALLOWED_COMMERCIAL_STYLE_PROMPT_TERMS =
  /\b(zelda|stardew|diablo|runescape|tibia|albion online|world of warcraft|warcraft)\b/i;

export async function verifyTerrainAtlas(manifestPath = DEFAULT_MANIFEST) {
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifestDir = path.dirname(absoluteManifestPath);
  const errors = [];
  const warnings = [];
  let manifest;

  try {
    manifest = JSON.parse(await readFile(absoluteManifestPath, "utf8"));
  } catch (err) {
    return {
      ok: false,
      manifestPath: absoluteManifestPath,
      tileCount: 0,
      errors: [`manifest could not be read: ${err.message}`],
      warnings,
    };
  }

  validateManifest(manifest, absoluteManifestPath, manifestDir, errors, warnings);
  await validateTileSheetImage(manifest, manifestDir, errors);

  return {
    ok: errors.length === 0,
    manifestPath: absoluteManifestPath,
    tileCount: Array.isArray(manifest.tiles) ? manifest.tiles.length : 0,
    errors,
    warnings,
  };
}

function validateManifest(manifest, manifestPath, manifestDir, errors, warnings) {
  if (!isObject(manifest)) {
    errors.push(`${manifestPath}: manifest must be an object`);
    return;
  }
  if (manifest.schemaVersion !== TERRAIN_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${JSON.stringify(TERRAIN_SCHEMA_VERSION)}`);
  }

  try {
    normalizeTerrainAtlas(manifest);
  } catch (err) {
    errors.push(err.message);
  }

  validateProjection(manifest.projection, errors);
  validateTileSheetPath(manifest.tileSheet, manifestDir, errors);
  validateTileCoverage(manifest.tiles, errors, warnings);
  validateProvenance(manifest.provenance, manifest.approval, errors);
  validateApproval(manifest.approval, errors);
}

function validateProjection(projection, errors) {
  if (!isObject(projection)) return;
  if (projection.tileWidth !== PROJECTION.tileW || projection.tileHeight !== PROJECTION.tileH) {
    errors.push(`projection tile dimensions must be ${PROJECTION.tileW}x${PROJECTION.tileH}`);
  }
  if (projection.tileWidth !== projection.tileHeight) {
    errors.push("projection tiles must be 1:1 diamonds, not 2:1 dimetric tiles");
  }
}

function validateTileSheetPath(tileSheet, manifestDir, errors) {
  if (!isObject(tileSheet)) return;
  if (!isSafeRelativePath(tileSheet.image)) {
    errors.push("tileSheet.image must be a safe relative PNG path");
    return;
  }
  if (!isSha256Hex(tileSheet.sha256)) {
    errors.push("tileSheet.sha256 must be a lowercase SHA-256 hex digest");
  }
  const resolved = path.resolve(manifestDir, tileSheet.image);
  if (!isSubpath(manifestDir, resolved)) {
    errors.push("tileSheet.image must stay inside the terrain asset directory");
  }
  if (path.extname(tileSheet.image).toLowerCase() !== ".png") {
    errors.push("tileSheet.image must point to a PNG file");
  }
}

function validateTileCoverage(tiles, errors, warnings) {
  if (!Array.isArray(tiles)) return;

  const seenBaseMaterials = new Set();
  const seenSlopeMaterials = new Set();
  const seenTransitionMaterials = new Set();
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
  }
}

function validateProvenance(provenance, approval, errors) {
  if (!isObject(provenance)) {
    errors.push("provenance must be an object");
    return;
  }
  if (provenance.cleanRoom !== true) {
    errors.push("provenance.cleanRoom must be true");
  }
  for (const key of ["source", "createdAt", "license", "reviewer", "prompt"]) {
    if (!isNonEmptyString(provenance[key])) {
      errors.push(`provenance.${key} must be a non-empty string`);
    }
  }
  if (isNonEmptyString(provenance.prompt)) {
    validatePromptText(provenance.prompt, "provenance.prompt", errors);
  }

  const isPlaceholder = isObject(approval) && approval.state === "placeholder";
  if (isPlaceholder) return;

  for (const key of ["method", "tool", "toolVersion", "sourceHash", "termsSnapshot"]) {
    if (!isNonEmptyString(provenance[key])) {
      errors.push(`provenance.${key} must be a non-empty string for non-placeholder terrain`);
    }
  }
}

function validatePromptText(prompt, prefix, errors) {
  if (DISALLOWED_CLEAN_ROOM_PROMPT_TERMS.test(prompt)) {
    errors.push(`${prefix} contains disallowed UO-derived reference terms`);
  }
  if (DISALLOWED_PROJECTION_PROMPT_TERMS.test(prompt)) {
    errors.push(`${prefix} contains projection drift terms`);
  }
  if (DISALLOWED_COMMERCIAL_STYLE_PROMPT_TERMS.test(prompt)) {
    errors.push(`${prefix} contains commercial game/style reference terms`);
  }
}

function validateApproval(approval, errors) {
  if (!isObject(approval)) {
    errors.push("approval must be an object");
    return;
  }
  if (!ALLOWED_APPROVAL_STATES.has(approval.state)) {
    errors.push(`approval.state must be one of ${[...ALLOWED_APPROVAL_STATES].join(", ")}`);
  }
  if (approval.state === "approved") {
    if (!isNonEmptyString(approval.reviewer)) {
      errors.push("approval.reviewer is required for approved terrain");
    }
    if (!isNonEmptyString(approval.approvedAt)) {
      errors.push("approval.approvedAt is required for approved terrain");
    }
  }
}

async function validateTileSheetImage(manifest, manifestDir, errors) {
  if (!isObject(manifest?.tileSheet) || !isSafeRelativePath(manifest.tileSheet.image)) return;
  const imagePath = path.resolve(manifestDir, manifest.tileSheet.image);
  if (!isSubpath(manifestDir, imagePath)) return;

  let dimensions;
  let imageBytes;
  try {
    imageBytes = await readFile(imagePath);
    dimensions = readPngDimensions(imageBytes);
  } catch (err) {
    errors.push(`tileSheet.image could not be read as PNG: ${err.message}`);
    return;
  }

  const expectedWidth = manifest.tileSheet.columns * manifest.tileSheet.cellWidth;
  const expectedHeight = manifest.tileSheet.rows * manifest.tileSheet.cellHeight;
  if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
    errors.push(
      `tileSheet.image dimensions ${dimensions.width}x${dimensions.height} do not match declared grid ${expectedWidth}x${expectedHeight}`,
    );
  }
  if (isSha256Hex(manifest.tileSheet.sha256)) {
    const actualHash = sha256Hex(imageBytes);
    if (actualHash !== manifest.tileSheet.sha256) {
      errors.push(
        `tileSheet.sha256 ${manifest.tileSheet.sha256} does not match actual image hash ${actualHash}`,
      );
    }
  }
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256Hex(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isSafeRelativePath(value) {
  return (
    isNonEmptyString(value) &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]+/).includes("..")
  );
}

function isSubpath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function main() {
  const manifestPath = process.argv[2] ?? DEFAULT_MANIFEST;
  const result = await verifyTerrainAtlas(manifestPath);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
