import { readPngDimensions } from "../verify-sprite-manifest.js";
import { readGroundPatchDimensions } from "../terrain-atlas/image.js";
import { sha256Hex } from "./hash.js";
import { fetchBuffer, fetchJson } from "./http.js";

export async function inspectTerrainAssets(context) {
  const { response: manifestResponse, body: manifest } = await fetchJson(
    context,
    "/assets/terrain/manifest.json",
  );
  const { response: imageResponse, buffer: imageBuffer } = await fetchBuffer(
    context,
    `/assets/terrain/${manifest.tileSheet.image}`,
  );
  const imageDimensions = readPngDimensions(imageBuffer);
  const imageSha256 = sha256Hex(imageBuffer);
  const groundPatches = await Promise.all(
    (manifest.groundPatches ?? []).map(async (patch) => {
      const { response, buffer } = await fetchBuffer(context, `/assets/terrain/${patch.image}`);
      return {
        id: patch.id,
        biome: patch.biome,
        status: response.status,
        dimensions: readGroundPatchDimensions(buffer, pathExtension(patch.image)),
        actualSha256: sha256Hex(buffer),
        expectedSha256: patch.sha256,
        expectedWidth: patch.width,
        expectedHeight: patch.height,
      };
    }),
  );
  const { response: authorityResponse, body: authority } = await fetchJson(
    context,
    "/assets/terrain/detail-authority.json",
  );

  return {
    report: {
      manifestStatus: manifestResponse.status,
      imageStatus: imageResponse.status,
      authorityStatus: authorityResponse.status,
      schemaVersion: manifest.schemaVersion,
      tileSheet: manifest.tileSheet,
      imageDimensions,
      actualImageSha256: imageSha256,
      tileCount: manifest.tiles.length,
      groundPatches,
      authority: {
        schemaVersion: authority.schemaVersion,
        projection: authority.projection,
        profile: authority.profile,
        blockerCount: authority.blockers?.length,
        resourceNodeCount: authority.resourceNodes?.length,
        decayConsumerCount: authority.decayConsumers?.length,
      },
    },
    ok:
      manifestResponse.ok &&
      imageResponse.ok &&
      manifest.schemaVersion === "duskfell-terrain-atlas-v1" &&
      manifest.projection.kind === "military-plan-oblique" &&
      manifest.projection.tileWidth === 64 &&
      manifest.projection.tileHeight === 64 &&
      manifest.tileSheet.sha256 === imageSha256 &&
      imageDimensions.width === manifest.tileSheet.columns * manifest.tileSheet.cellWidth &&
      imageDimensions.height === manifest.tileSheet.rows * manifest.tileSheet.cellHeight &&
      manifest.tiles.some((tile) => tile.material === "water" && tile.surface?.walkable === false) &&
      groundPatches.length === 8 &&
      groundPatches.every(
        (patch) =>
          patch.status === 200 &&
          patch.actualSha256 === patch.expectedSha256 &&
          patch.dimensions.width === patch.expectedWidth &&
          patch.dimensions.height === patch.expectedHeight,
      ) &&
      authorityResponse.ok &&
      authority.schemaVersion === "duskfell-terrain-detail-authority-v1" &&
      authority.projection === "military-plan-oblique" &&
      authority.profile === "duskfell-terrain-v1" &&
      authority.blockers?.length > 0 &&
      authority.resourceNodes?.length > 0 &&
      authority.decayConsumers?.length > 0,
  };
}

function pathExtension(imagePath) {
  const dot = imagePath.lastIndexOf(".");
  return dot >= 0 ? imagePath.slice(dot) : "";
}
