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

export async function validateGroundPatchImages(manifest, manifestDir, errors) {
  if (!Array.isArray(manifest?.groundPatches)) return;

  await Promise.all(
    manifest.groundPatches.map(async (patch, index) => {
      if (!isObject(patch) || !isSafeRelativePath(patch.image)) return;
      const imagePath = path.resolve(manifestDir, patch.image);
      if (!isSubpath(manifestDir, imagePath)) return;

      let dimensions;
      let imageBytes;
      try {
        imageBytes = await readFile(imagePath);
        dimensions = readGroundPatchDimensions(imageBytes, path.extname(patch.image));
      } catch (err) {
        errors.push(`groundPatches[${index}].image could not be read: ${err.message}`);
        return;
      }

      if (dimensions.width !== patch.width || dimensions.height !== patch.height) {
        errors.push(
          `groundPatches[${index}].image dimensions ${dimensions.width}x${dimensions.height} do not match declared ${patch.width}x${patch.height}`,
        );
      }
      if (isSha256Hex(patch.sha256)) {
        const actualHash = sha256Hex(imageBytes);
        if (actualHash !== patch.sha256) {
          errors.push(
            `groundPatches[${index}].sha256 ${patch.sha256} does not match actual image hash ${actualHash}`,
          );
        }
      }
    }),
  );
}

export function readGroundPatchDimensions(bytes, extension) {
  if (extension.toLowerCase() === ".png") return readPngDimensions(bytes);
  return readWebpDimensions(bytes);
}

function readWebpDimensions(bytes) {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("invalid WebP header");
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > bytes.length) throw new Error("truncated WebP chunk");

    if (kind === "VP8 " && size >= 10) {
      if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) {
        throw new Error("invalid VP8 frame header");
      }
      return {
        width: bytes.readUInt16LE(data + 6) & 0x3fff,
        height: bytes.readUInt16LE(data + 8) & 0x3fff,
      };
    }
    if (kind === "VP8L" && size >= 5) {
      if (bytes[data] !== 0x2f) throw new Error("invalid VP8L frame header");
      const bits = bytes.readUInt32LE(data + 1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    if (kind === "VP8X" && size >= 10) {
      return {
        width: readUInt24LE(bytes, data + 4) + 1,
        height: readUInt24LE(bytes, data + 7) + 1,
      };
    }
    offset = data + size + (size % 2);
  }
  throw new Error("WebP image dimensions were not found");
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}
