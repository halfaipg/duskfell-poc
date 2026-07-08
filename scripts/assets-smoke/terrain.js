import { readPngDimensions } from "../verify-sprite-manifest.js";
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
      authorityResponse.ok &&
      authority.schemaVersion === "duskfell-terrain-detail-authority-v1" &&
      authority.projection === "military-plan-oblique" &&
      authority.profile === "duskfell-terrain-v1" &&
      authority.blockers?.length > 0 &&
      authority.resourceNodes?.length > 0 &&
      authority.decayConsumers?.length > 0,
  };
}
