import { detailFootprint, detailForTile } from "./terrain-details.js";
import { hash01 } from "./terrain-primitives.js";

export function addPlacementDetails(
  kit,
  placements,
  tilesByCoord,
  cols,
  rows,
  profile,
  occupiedFootprints,
  { seedStride, allowSettlement = false } = {},
) {
  const details = [];
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    const tileX = Math.round(kit.x + placement.dx);
    const tileY = Math.round(kit.y + placement.dy);
    if (tileX < 0 || tileY < 0 || tileX >= cols || tileY >= rows) continue;
    const tile = tilesByCoord.get(`${tileX}:${tileY}`);
    if (!tile || tile.material === "water" || (!allowSettlement && tile.material === "settlement")) continue;
    const roll = hash01(tileX, tileY, kit.seed + index * seedStride);
    tryAddDetail(details, tile, profile, placement.kind, roll, placement.scale[0], placement.scale[1], occupiedFootprints, cols, rows, {
      kitId: kit.id,
      kitKind: kit.kind,
      kitRole: placement.role,
      u: placement.u,
      v: placement.v,
    });
  }
  return details;
}

export function tryAddDetail(details, tile, profile, kind, roll, minScale, maxScale, occupiedFootprints, cols, rows, options = {}) {
  const footprint = detailFootprint(kind);
  if (footprint.reserveRadiusTiles > 0 && !reserveDetailFootprint(tile, footprint.reserveRadiusTiles, occupiedFootprints, cols, rows)) {
    return false;
  }
  details.push(detailForTile(tile, profile, kind, roll, minScale, maxScale, footprint, options));
  return true;
}

function reserveDetailFootprint(tile, radius, occupiedFootprints, cols, rows) {
  for (let y = tile.y - radius; y <= tile.y + radius; y += 1) {
    for (let x = tile.x - radius; x <= tile.x + radius; x += 1) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
      if (occupiedFootprints.has(`${x}:${y}`)) return false;
    }
  }
  for (let y = tile.y - radius; y <= tile.y + radius; y += 1) {
    for (let x = tile.x - radius; x <= tile.x + radius; x += 1) {
      occupiedFootprints.add(`${x}:${y}`);
    }
  }
  return true;
}
