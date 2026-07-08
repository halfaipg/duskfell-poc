import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export async function expectedManifestState() {
  const spriteManifest = JSON.parse(await readFile("assets/sprites/manifest.json", "utf8"));
  const terrainManifest = JSON.parse(await readFile("assets/terrain/manifest.json", "utf8"));
  const terrainAuthority = JSON.parse(await readFile("assets/terrain/detail-authority.json", "utf8"));
  return {
    maxManifestBytes: 256 * 1024,
    maxImageBytes: 2 * 1024 * 1024,
    sprites: {
      schemaVersion: spriteManifest.schemaVersion,
      entryCount: spriteManifest.sheets.length,
      images: await Promise.all(
        spriteManifest.sheets.map(async (sheet) => ({
          id: sheet.id,
          image: sheet.image,
          sha256: sheet.imageSha256,
          bytes: (await stat(path.join("assets", "sprites", sheet.image))).size,
          approvalState: sheet.approval?.state,
        })),
      ),
    },
    terrain: {
      schemaVersion: terrainManifest.schemaVersion,
      entryCount: terrainManifest.tiles.length,
      images: [
        {
          id: terrainManifest.tileSheet.id,
          image: terrainManifest.tileSheet.image,
          sha256: terrainManifest.tileSheet.sha256,
          bytes: (await stat(path.join("assets", "terrain", terrainManifest.tileSheet.image))).size,
          approvalState: terrainManifest.approval?.state,
        },
      ],
    },
    terrainAuthority: {
      schemaVersion: terrainAuthority.schemaVersion,
      profile: terrainAuthority.profile,
      seed: terrainAuthority.seed,
      unitsPerTile: terrainAuthority.unitsPerTile,
      blockerCount: terrainAuthority.blockers.length,
      resourceNodeCount: terrainAuthority.resourceNodes.length,
      decayConsumerCount: terrainAuthority.decayConsumers.length,
    },
  };
}
