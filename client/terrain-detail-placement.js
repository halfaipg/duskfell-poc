import { compositionKitDetails } from "./terrain-detail-kit-details.js";
import { detailsForTile } from "./terrain-detail-tile.js";

export function terrainDetails(tiles, cols, rows, safeRadiusTiles, profile, compositionKits = []) {
  const occupiedFootprints = new Set();
  const details = [];
  const tilesByCoord = new Map(tiles.map((tile) => [`${tile.x}:${tile.y}`, tile]));
  for (const kit of compositionKits) {
    details.push(...compositionKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints));
  }
  for (const tile of tiles) {
    details.push(...detailsForTile(tile, cols, rows, safeRadiusTiles, profile, occupiedFootprints));
  }
  return details;
}
