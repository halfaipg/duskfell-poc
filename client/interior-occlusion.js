export function interiorOccupancy(space, playerPosition) {
  if (!space || !playerPosition || !Number.isFinite(playerPosition.x) || !Number.isFinite(playerPosition.y)) {
    return {
      inside: false,
      floor: null,
      room: null,
      portal: null,
      activeRoomIds: [],
      occluders: interiorOccluderStates(space, null),
      roofAlpha: space?.roof?.alpha ?? 0.82,
    };
  }
  const room = interiorRoomAt(space, playerPosition);
  const padding = Math.max(0, space.revealPadding ?? 0);
  const inside = Boolean(room) || pointInBounds(playerPosition, space.bounds, padding);
  const floor = inside ? interiorFloorAt(space, playerPosition.z ?? 0) : null;
  const portal = inside ? interiorPortalAt(space, playerPosition) : null;
  const height = inside ? interiorHeightAt(space, playerPosition) : null;
  const activeRoomIds = activeRoomsFor(room, portal);
  const occluders = interiorOccluderStates(space, { room, portal, floor, activeRoomIds });
  return {
    inside,
    floor,
    room,
    portal,
    height,
    activeRoomIds,
    occluders,
    roofAlpha: inside ? (space.roof?.revealedAlpha ?? 0.14) : (space.roof?.alpha ?? 0.82),
  };
}

export function interiorRoomAt(space, playerPosition) {
  if (!space || !playerPosition || !Array.isArray(space.rooms)) return null;
  const floor = interiorFloorAt(space, playerPosition.z ?? 0);
  const candidates = space.rooms.filter((room) => pointInBounds(playerPosition, room.bounds, Math.max(0, room.revealPadding ?? 0)));
  if (candidates.length === 0) return null;
  return candidates.find((room) => room.floorLevel === floor?.level)
    ?? candidates.sort((left, right) => (left.floorLevel ?? 0) - (right.floorLevel ?? 0))[0];
}

export function interiorOccluderStates(space, occupancy) {
  const fallback = space?.roof ? [{
    id: `${space.id ?? "interior"}-roof`,
    kind: "roof",
    floorLevel: Math.max(0, ...(space.floors ?? []).map((floor) => floor.level ?? 0)) + 1,
    roomIds: (space.rooms ?? []).map((room) => room.id),
    bounds: space.bounds,
    alpha: space.roof.alpha,
    revealedAlpha: space.roof.revealedAlpha,
    z: space.roof.z,
    material: space.roof.material,
  }] : [];
  const occluders = Array.isArray(space?.occluders) && space.occluders.length ? space.occluders : fallback;
  const activeRoomIds = new Set(occupancy?.activeRoomIds ?? []);
  const activeFloor = occupancy?.floor?.level ?? -Infinity;
  return occluders.map((occluder) => {
    const roomIds = occluder.roomIds ?? [];
    const roomMatch = roomIds.length === 0 ? Boolean(occupancy) : roomIds.some((id) => activeRoomIds.has(id));
    const aboveOrAtPlayer = (occluder.floorLevel ?? Infinity) >= activeFloor;
    const revealed = roomMatch && aboveOrAtPlayer;
    return {
      ...occluder,
      revealed,
      alpha: revealed
        ? (occluder.revealedAlpha ?? space?.roof?.revealedAlpha ?? 0.14)
        : (occluder.alpha ?? space?.roof?.alpha ?? 0.82),
    };
  });
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

function activeRoomsFor(room, portal) {
  const ids = new Set(room ? [room.id] : []);
  if (portal?.fromRoom) ids.add(portal.fromRoom);
  if (portal?.toRoom) ids.add(portal.toRoom);
  return [...ids];
}

function pointInBounds(point, bounds, padding = 0) {
  return Boolean(bounds)
    && point.x >= bounds.minX - padding
    && point.x <= bounds.maxX + padding
    && point.y >= bounds.minY - padding
    && point.y <= bounds.maxY + padding;
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
