import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { isObject, isSafeRelativePath, isSha256Hex, isSubpath } from "./validation.js";

export async function validateSheetImage(sheet, index, manifestDir, errors) {
  if (!isObject(sheet) || !isSafeRelativePath(sheet.image) || !isObject(sheet.frameGrid)) return;

  const prefix = `sheets[${index}]`;
  const imagePath = path.resolve(manifestDir, sheet.image);
  if (!isSubpath(manifestDir, imagePath)) return;

  let dimensions;
  let imageBytes;
  try {
    imageBytes = await readFile(imagePath);
    dimensions = readPngDimensions(imageBytes);
  } catch (err) {
    errors.push(`${prefix}.image could not be read as PNG: ${err.message}`);
    return;
  }

  const expectedWidth = sheet.frameGrid.columns * sheet.frameGrid.cellWidth;
  const expectedHeight = sheet.frameGrid.rows * sheet.frameGrid.cellHeight;
  if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
    errors.push(
      `${prefix}.image dimensions ${dimensions.width}x${dimensions.height} do not match declared grid ${expectedWidth}x${expectedHeight}`,
    );
  }
  if (isSha256Hex(sheet.imageSha256)) {
    const actualHash = sha256Hex(imageBytes);
    if (actualHash !== sheet.imageSha256) {
      errors.push(
        `${prefix}.imageSha256 ${sheet.imageSha256} does not match actual image hash ${actualHash}`,
      );
    }
  }
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function readPngDimensions(buffer) {
  if (buffer.length < 24) {
    throw new Error("file is too small for a PNG header");
  }
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [index, byte] of signature.entries()) {
    if (buffer[index] !== byte) {
      throw new Error("file does not have a PNG signature");
    }
  }
  if (buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("PNG is missing an IHDR chunk");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}
