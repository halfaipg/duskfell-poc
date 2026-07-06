import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function updateSpriteImageHash({
  manifestPath,
  sheetId,
  imagePath,
}) {
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifest = JSON.parse(await readFile(absoluteManifestPath, "utf8"));
  const sheet = manifest.sheets?.find((candidate) => candidate.id === sheetId);
  if (!sheet) {
    throw new Error(`sprite sheet ${sheetId} was not found in ${absoluteManifestPath}`);
  }
  sheet.imageSha256 = sha256Hex(await readFile(path.resolve(imagePath)));
  await writeJson(absoluteManifestPath, manifest);
  return sheet.imageSha256;
}

export async function updateTerrainAtlasHash({
  manifestPath,
  imagePath,
}) {
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifest = JSON.parse(await readFile(absoluteManifestPath, "utf8"));
  if (!manifest.tileSheet || typeof manifest.tileSheet !== "object") {
    throw new Error(`terrain manifest ${absoluteManifestPath} is missing tileSheet`);
  }
  manifest.tileSheet.sha256 = sha256Hex(await readFile(path.resolve(imagePath)));
  await writeJson(absoluteManifestPath, manifest);
  return manifest.tileSheet.sha256;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
