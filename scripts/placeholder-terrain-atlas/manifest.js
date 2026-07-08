import { readFile, writeFile } from "node:fs/promises";

export async function updateTerrainManifestShape({ manifestPath, rows, materials, terrainTiles }) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.tileSheet.rows = rows;
  manifest.tileSheet.frameCount = rows * materials.length;
  manifest.tiles = terrainTiles();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
