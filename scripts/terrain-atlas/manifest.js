import path from "node:path";

import { normalizeTerrainAtlas } from "../../client/terrain-assets.js";
import { PROJECTION } from "../../client/projection.js";
import { TERRAIN_SCHEMA_VERSION } from "./constants.js";
import { validateTileCoverage } from "./coverage.js";
import { validateApproval, validateProvenance } from "./provenance.js";
import { isObject, isSafeRelativePath, isSha256Hex, isSubpath } from "./validators.js";

export function validateManifest(manifest, manifestPath, manifestDir, errors, warnings) {
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
