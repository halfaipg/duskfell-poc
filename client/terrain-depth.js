import { PROJECTION } from "./projection.js";

export function terrainDetailDepthProfile(detail) {
  const occlusion = detail?.occlusion ?? {};
  const footprint = detail?.footprint ?? {};
  const vertical = finiteOr(detail?.vertical, occlusion.heightTiles, 0);
  const radiusTiles = clamp(
    finiteOr(occlusion.radiusTiles, Math.max(footprint.widthTiles ?? 0, footprint.heightTiles ?? 0) * 0.72, 0.5),
    0.18,
    2.4,
  );
  const heightTiles = clamp(finiteOr(occlusion.heightTiles, vertical, 0), 0, 3.2);
  const fadeAlpha = clamp(finiteOr(occlusion.fadeAlpha, 0.58), 0.22, 1);

  return {
    radiusTiles,
    heightTiles,
    fadeAlpha,
    vertical,
  };
}

export function terrainDetailSortBias(detail) {
  if (Number.isFinite(detail?.sortBias)) return detail.sortBias;
  const profile = terrainDetailDepthProfile(detail);
  const baseBias = profile.vertical * 9 + profile.heightTiles * 4;
  const footprintBias = ((detail?.footprint?.heightTiles ?? 0.4) - 0.4) * 3;
  return clamp(baseBias + footprintBias - 3, -6, 18);
}

export function terrainDetailOcclusionAlpha(detail, playerPosition) {
  if (!detail?.occlusion || !playerPosition) return 1;
  const profile = terrainDetailDepthProfile(detail);
  const radius = profile.radiusTiles * PROJECTION.unitsPerTile;
  const dy = playerPosition.y - detail.y;
  const dx = Math.abs(playerPosition.x - detail.x);
  const verticalReach = radius * (0.62 + profile.heightTiles * 0.78);
  const lowerBand = -radius * 0.22;
  const upperBand = Math.max(radius * 0.65, verticalReach);

  if (dy < lowerBand || dy > upperBand || dx > radius * (0.88 + profile.heightTiles * 0.12)) {
    return 1;
  }

  const normalizedX = dx / Math.max(1, radius * (0.78 + profile.heightTiles * 0.08));
  const normalizedY = Math.max(0, dy) / Math.max(1, upperBand);
  const closeness = clamp(1 - Math.hypot(normalizedX * 0.88, normalizedY * 0.72), 0, 1);
  return 1 - (1 - profile.fadeAlpha) * closeness;
}

function finiteOr(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
