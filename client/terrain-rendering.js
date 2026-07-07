const FLAT_SURFACE_MATERIALS = new Set(["water", "settlement"]);
const RAISED_EDGE_DROP_THRESHOLD = 0.75;
const HIGH_TERRAIN_AVERAGE_THRESHOLD = 0.5;

export function shouldUseRaisedTerrainArt(tile) {
  if (!tile || FLAT_SURFACE_MATERIALS.has(tile.material)) return false;

  const height = tile.height ?? {};
  if (tile.sloped || (height.range ?? 0) > 0) return true;
  if ((tile.elevationEdges ?? []).some((edge) => edge.drop >= RAISED_EDGE_DROP_THRESHOLD)) return true;

  const composition = tile.composition ?? {};
  const ridgeLike = composition.zone === "ridge" || composition.elevationBand === "high";
  return ridgeLike && (height.average ?? 0) > HIGH_TERRAIN_AVERAGE_THRESHOLD;
}
