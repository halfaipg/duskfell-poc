import { projectMap } from "./projection.js";
import { clamp, terrainHeightMetadata } from "./terrain-primitives.js";

export function projectTerrainTile(tile, origin) {
  return {
    nw: projectMap(tile.x, tile.y, tile.heights.nw, origin),
    ne: projectMap(tile.x + 1, tile.y, tile.heights.ne, origin),
    se: projectMap(tile.x + 1, tile.y + 1, tile.heights.se, origin),
    sw: projectMap(tile.x, tile.y + 1, tile.heights.sw, origin),
  };
}

export function terrainFacets(tile) {
  if (!tile?.sloped) return [];

  const { slopeX, slopeY, range } = tile.height ?? terrainHeightMetadata(tile.heights);
  const alpha = clamp(0.2 + range * 0.055, 0.2, 0.48);
  const lightBias = ((tile.height?.light ?? 0.58) - 0.58) * 0.18;

  return [
    {
      name: "right",
      corners: ["nw", "ne", "se"],
      shade: clamp(slopeX * 0.1 - slopeY * 0.08 - 0.05 + lightBias, -0.36, 0.32),
      alpha,
    },
    {
      name: "left",
      corners: ["nw", "se", "sw"],
      shade: clamp(slopeY * 0.1 - slopeX * 0.08 + 0.06 + lightBias, -0.34, 0.36),
      alpha: alpha * 0.9,
    },
  ];
}
