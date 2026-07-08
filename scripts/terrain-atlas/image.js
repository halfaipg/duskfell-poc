import { readFile } from "node:fs/promises";
import path from "node:path";

import { readPngDimensions } from "../verify-sprite-manifest.js";
import { isObject, isSafeRelativePath, isSha256Hex, isSubpath, sha256Hex } from "./validators.js";

export async function validateTileSheetImage(manifest, manifestDir, errors) {
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
