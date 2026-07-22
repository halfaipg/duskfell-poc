import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_MANIFEST } from "./terrain-atlas/constants.js";
import { validateGroundPatchImages, validateTileSheetImage, validateWorldMapImage } from "./terrain-atlas/image.js";
import { validateManifest } from "./terrain-atlas/manifest.js";

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
  await validateGroundPatchImages(manifest, manifestDir, errors);
  await validateWorldMapImage(manifest, manifestDir, errors);

  return {
    ok: errors.length === 0,
    manifestPath: absoluteManifestPath,
    tileCount: Array.isArray(manifest.tiles) ? manifest.tiles.length : 0,
    errors,
    warnings,
  };
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
