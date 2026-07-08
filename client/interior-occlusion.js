export function interiorOccupancy(space, playerPosition) {
  if (!space || !playerPosition || !Number.isFinite(playerPosition.x) || !Number.isFinite(playerPosition.y)) {
    return {
      inside: false,
      floor: null,
      portal: null,
      roofAlpha: space?.roof?.alpha ?? 0.82,
    };
  }
  const padding = Math.max(0, space.revealPadding ?? 0);
  const bounds = space.bounds;
  const inside =
    bounds &&
    playerPosition.x >= bounds.minX - padding &&
    playerPosition.x <= bounds.maxX + padding &&
    playerPosition.y >= bounds.minY - padding &&
    playerPosition.y <= bounds.maxY + padding;
  const floor = inside ? interiorFloorAt(space, playerPosition.z ?? 0) : null;
  const portal = inside ? interiorPortalAt(space, playerPosition) : null;
  const height = inside ? interiorHeightAt(space, playerPosition) : null;
  return {
    inside,
    floor,
    portal,
    height,
    roofAlpha: inside ? (space.roof?.revealedAlpha ?? 0.14) : (space.roof?.alpha ?? 0.82),
  };
}

export function interiorFloorAt(space, z = 0) {
  if (!space || !Array.isArray(space.floors) || space.floors.length === 0) return null;
  const sorted = [...space.floors].sort((a, b) => a.z - b.z);
  let floor = sorted[0];
  for (const candidate of sorted) {
    if (z + 0.001 >= candidate.z) floor = candidate;
  }
  return floor;
}

export function interiorPortalAt(space, playerPosition) {
  if (!space || !playerPosition || !Array.isArray(space.portals)) return null;
  for (const portal of space.portals) {
    const bounds = portal.bounds;
    if (!bounds) continue;
    if (
      playerPosition.x >= bounds.minX &&
      playerPosition.x <= bounds.maxX &&
      playerPosition.y >= bounds.minY &&
      playerPosition.y <= bounds.maxY
    ) {
      return portal;
    }
  }
  return null;
}

export function interiorHeightAt(space, playerPosition) {
  if (!space || !playerPosition) return null;
  const portal = interiorPortalAt(space, playerPosition);
  if (portal) {
    return {
      z: interiorPortalHeightAt(portal, playerPosition),
      source: "portal",
      portal,
    };
  }
  const floor = interiorFloorAt(space, playerPosition.z ?? 0);
  if (!floor) return null;
  return {
    z: floor.z,
    source: "floor",
    floor,
  };
}

export function interiorPortalHeightAt(portal, playerPosition) {
  const bounds = portal?.bounds;
  if (!bounds || !playerPosition) return portal?.fromZ ?? 0;
  const fromZ = Number.isFinite(portal.fromZ) ? portal.fromZ : 0;
  const toZ = Number.isFinite(portal.toZ) ? portal.toZ : fromZ;
  const axis = portal.axis === "x" ? "x" : "y";
  const min = axis === "x" ? bounds.minX : bounds.minY;
  const max = axis === "x" ? bounds.maxX : bounds.maxY;
  const value = axis === "x" ? playerPosition.x : playerPosition.y;
  const t = max > min ? clamp01((value - min) / (max - min)) : 0;
  return fromZ + (toZ - fromZ) * t;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
