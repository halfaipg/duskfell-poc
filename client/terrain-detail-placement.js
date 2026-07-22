import { compositionKitDetails } from "./terrain-detail-kit-details.js";
import { detailsForTile } from "./terrain-detail-tile.js";

export function terrainDetails(
  tiles,
  cols,
  rows,
  safeRadiusTiles,
  profile,
  compositionKits = [],
  { ambientBounds = null } = {},
) {
  const occupiedFootprints = new Set();
  const details = [];
  const tilesByCoord = new Map(tiles.map((tile) => [`${tile.x}:${tile.y}`, tile]));
  for (const kit of compositionKits) {
    details.push(...compositionKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints));
  }
  for (const tile of tiles) {
    if (!insideAmbientBounds(tile, ambientBounds)) continue;
    details.push(...detailsForTile(tile, cols, rows, safeRadiusTiles, profile, occupiedFootprints));
  }
  return details;
}

function insideAmbientBounds(tile, bounds) {
  if (!bounds) return true;
  return tile.x >= bounds.offsetX
    && tile.y >= bounds.offsetY
    && tile.x < bounds.offsetX + bounds.cols
    && tile.y < bounds.offsetY + bounds.rows;
}
