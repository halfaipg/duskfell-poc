import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateSheetImage, readPngDimensions } from "./sprite-manifest/image.js";
import { validatePaperdolls } from "./sprite-manifest/paperdoll.js";
import { validateProjection } from "./sprite-manifest/projection.js";
import { validateSheet } from "./sprite-manifest/sheet.js";
import { isObject } from "./sprite-manifest/validation.js";

const DEFAULT_MANIFEST = "assets/sprites/manifest.json";
const SPRITE_SCHEMA_VERSION = "sundermere-sprite-manifest-v1";

export { readPngDimensions };

export async function verifySpriteManifest(manifestPath = DEFAULT_MANIFEST) {
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifestDir = path.dirname(absoluteManifestPath);
  const manifest = JSON.parse(await readFile(absoluteManifestPath, "utf8"));
  const errors = [];
  const warnings = [];

  validateManifest(manifest, absoluteManifestPath, manifestDir, errors, warnings);

  if (Array.isArray(manifest.sheets)) {
    await Promise.all(
      manifest.sheets.map((sheet, index) =>
        validateSheetImage(sheet, index, manifestDir, errors),
      ),
    );
  }

  return {
    ok: errors.length === 0,
    manifestPath: absoluteManifestPath,
    sheetCount: Array.isArray(manifest.sheets) ? manifest.sheets.length : 0,
    errors,
    warnings,
  };
}

function validateManifest(manifest, manifestPath, manifestDir, errors, warnings) {
  if (!isObject(manifest)) {
    errors.push(`${manifestPath}: manifest must be an object`);
    return;
  }

  if (manifest.schemaVersion !== SPRITE_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion must be ${JSON.stringify(SPRITE_SCHEMA_VERSION)}, got ${JSON.stringify(
        manifest.schemaVersion,
      )}`,
    );
  }

  validateProjection(manifest.projection, errors);

  if (!Array.isArray(manifest.sheets)) {
    errors.push("sheets must be an array");
    return;
  }

  const seenIds = new Set();
  for (const [index, sheet] of manifest.sheets.entries()) {
    validateSheet(sheet, index, manifestDir, seenIds, errors);
  }
  validatePaperdolls(manifest.paperdolls, manifest.sheets, errors);

  if (manifest.sheets.length === 0) {
    warnings.push("manifest has no sheets yet; asset contract is present but no art is approved");
  }
}

async function main() {
  const manifestPath = process.argv[2] ?? DEFAULT_MANIFEST;
  const result = await verifySpriteManifest(manifestPath);
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
