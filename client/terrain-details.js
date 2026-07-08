import { terrainDetailAuthorityMetadata } from "./terrain-detail-authority.js";
import { detailFootprint } from "./terrain-detail-footprints.js";
import { detailMetadata } from "./terrain-detail-metadata.js";
import { bilerp, hash01, hashUnit } from "./terrain-primitives.js";

export { terrainDetailAuthority } from "./terrain-detail-authority.js";
export { detailFootprint } from "./terrain-detail-footprints.js";

export function detailForTile(tile, profile, kind, roll, minScale, maxScale, footprint = detailFootprint(kind), options = {}) {
  const seed = Math.round(roll * 10000);
  const u = options.u ?? 0.18 + hash01(tile.x, tile.y, profile.seed + seed + 17) * 0.64;
  const v = options.v ?? 0.18 + hash01(tile.x, tile.y, profile.seed + seed + 29) * 0.64;
  const z = bilerp(tile.heights.nw, tile.heights.ne, tile.heights.sw, tile.heights.se, u, v);
  const metadata = detailMetadata(tile, profile, kind, seed, options);
  const kitId = options.kitId ?? tile.composition?.kitId ?? null;
  const kitKind = options.kitKind ?? tile.composition?.kitKind ?? null;
  const kitRole = options.kitRole ?? tile.composition?.kitRole ?? "none";
  const id = `${kitId ? `${kitId}-` : ""}${kind}-${tile.x}-${tile.y}-${seed}`;
  const authority = terrainDetailAuthorityMetadata(id, tile, profile, kind, seed, u, v, z, footprint, metadata, {
    kitId,
    kitKind,
    kitRole,
  });
  return {
    id,
    kind,
    ...metadata,
    material: tile.material,
    x: (tile.x + u) * profile.unitsPerTile,
    y: (tile.y + v) * profile.unitsPerTile,
    z,
    scale: (minScale + hash01(tile.x, tile.y, profile.seed + seed + 41) * (maxScale - minScale)) * (metadata.scaleMultiplier ?? 1),
    shade: hashUnit(tile.x, tile.y, profile.seed + seed + 53),
    zone: tile.composition?.zone ?? "meadow",
    objectBand: tile.composition?.objectBand ?? "open",
    kitId,
    kitKind,
    kitRole,
    footprint,
    tile: { x: tile.x, y: tile.y },
    anchor: { u, v, z },
    authority,
  };
}
