export const TERRAIN_DETAIL_OBJECT_PREFIX = "terrain-detail:";

// Vegetation-only art pass: everything on screen must be current-generation
// art (terrain, stream, the tree/bush/tuft kit, players). Placeholder-era
// props, items, ecology decals and procedural cue overlays stay hidden until
// each gets its own art pass.
export const VEGETATION_ONLY_ART_PASS = true;
export const VISIBLE_DETAIL_KINDS = new Set(["tree", "scrub", "tuft"]);
export const VISIBLE_OBJECT_KINDS = new Set(["saplingTree"]);

export function isTerrainDetailAuthorityObject(object) {
  return typeof object?.id === "string" && object.id.startsWith(TERRAIN_DETAIL_OBJECT_PREFIX);
}

export function terrainDetailAuthorityObjectId(detail) {
  const resourceNodeId = detail?.authority?.resourceNodeId;
  if (typeof resourceNodeId === "string" && resourceNodeId.startsWith(TERRAIN_DETAIL_OBJECT_PREFIX)) {
    return resourceNodeId;
  }
  if (typeof detail?.id === "string" && detail.id.length > 0) {
    return `${TERRAIN_DETAIL_OBJECT_PREFIX}${detail.id}`;
  }
  return null;
}

export function terrainDetailAuthorityObjectIds(details) {
  const ids = new Set();
  if (!Array.isArray(details)) return ids;
  for (const detail of details) {
    const id = terrainDetailAuthorityObjectId(detail);
    if (id) ids.add(id);
  }
  return ids;
}

export function shouldDrawTerrainDetailAuthorityBody(object, terrainDetailObjectIds) {
  if (!isTerrainDetailAuthorityObject(object)) return true;
  return !terrainDetailObjectIds?.has?.(object.id);
}

export function shouldDrawTerrainDetailAuthorityCue(object, playerPosition, options = {}) {
  if (!isTerrainDetailAuthorityObject(object)) return false;
  if (options.debug) return true;
  if (!playerPosition) return false;
  const cueRadius = options.radius ?? 150;
  const dx = (object.x ?? 0) - playerPosition.x;
  const dy = (object.y ?? 0) - playerPosition.y;
  return dx * dx + dy * dy <= cueRadius * cueRadius;
}

export function shouldDrawWorldObjectLabel(object, playerPosition, options = {}) {
  if (!object || QUIET_OBJECT_LABEL_KINDS.has(object.kind)) return false;
  if (options.debug) return true;
  if (!playerPosition) return false;
  const radius = options.radius ?? labelRadiusForObject(object);
  return distanceSquared(object, playerPosition) <= radius * radius;
}

export function shouldDrawPlayerNameLabel(player, playerPosition, localPlayerPosition, options = {}) {
  if (!player) return false;
  if (options.isLocal || options.debug) return true;
  if (!playerPosition || !localPlayerPosition) return false;
  const radius = options.radius ?? 90;
  const crowdedRadius = options.crowdedRadius ?? 96;
  const nearbyPlayerCount = options.nearbyPlayerCount ?? 0;
  if (nearbyPlayerCount >= 3 && distanceSquared(playerPosition, localPlayerPosition) <= crowdedRadius * crowdedRadius) {
    return false;
  }
  return distanceSquared(playerPosition, localPlayerPosition) <= radius * radius;
}

export function nearestInteractableObject(objects, playerPosition, options = {}) {
  if (!Array.isArray(objects) || !playerPosition) return null;
  const radius = options.radius ?? 170;
  let nearest = null;
  let nearestDistanceSquared = radius * radius;
  for (const object of objects) {
    if (!object || QUIET_OBJECT_LABEL_KINDS.has(object.kind)) continue;
    const currentDistanceSquared = distanceSquared(object, playerPosition);
    if (currentDistanceSquared > nearestDistanceSquared) continue;
    nearest = object;
    nearestDistanceSquared = currentDistanceSquared;
  }
  return nearest;
}

const QUIET_OBJECT_LABEL_KINDS = new Set(["saplingTree", "deadwood", "myceliumPatch", "ruin"]);

function labelRadiusForObject(object) {
  const radii = {
    registrar: 210,
    forge: 190,
    grove: 170,
    ore: 170,
    shrine: 180,
    fieldCoil: 150,
  };
  return radii[object.kind] ?? 150;
}

function distanceSquared(a, b) {
  const dx = (a.x ?? 0) - (b.x ?? 0);
  const dy = (a.y ?? 0) - (b.y ?? 0);
  return dx * dx + dy * dy;
}
