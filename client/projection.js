export const PROJECTION = {
  kind: "military-plan-oblique",
  tileW: 64,
  tileH: 64,
  halfW: 32,
  halfH: 32,
  tileAspectRatio: 1,
  axisAngleDegrees: 45,
  heightAxis: "screen-y",
  zPx: 6,
  unitsPerTile: 64,
};

export function defaultOrigin(map) {
  return {
    x: (map.height / PROJECTION.unitsPerTile) * PROJECTION.halfW + 180,
    y: 72,
  };
}

export function worldToMap(x, y, z = 0) {
  return {
    mapX: x / PROJECTION.unitsPerTile,
    mapY: y / PROJECTION.unitsPerTile,
    mapZ: z,
  };
}

export function projectMap(mapX, mapY, mapZ = 0, origin = { x: 0, y: 0 }) {
  return {
    x: origin.x + (mapX - mapY) * PROJECTION.halfW,
    y: origin.y + (mapX + mapY) * PROJECTION.halfH - mapZ * PROJECTION.zPx,
  };
}

export function projectWorld(x, y, z = 0, origin = { x: 0, y: 0 }) {
  const tile = worldToMap(x, y, z);
  return projectMap(tile.mapX, tile.mapY, tile.mapZ, origin);
}

export function screenToMap(screenX, screenY, origin = { x: 0, y: 0 }) {
  const dx = (screenX - origin.x) / PROJECTION.halfW;
  const dy = (screenY - origin.y) / PROJECTION.halfH;
  return {
    mapX: (dy + dx) / 2,
    mapY: (dy - dx) / 2,
  };
}

export function diamondForTile(mapX, mapY, origin = { x: 0, y: 0 }) {
  const top = projectMap(mapX, mapY, 0, origin);
  return [
    top,
    { x: top.x + PROJECTION.halfW, y: top.y + PROJECTION.halfH },
    { x: top.x, y: top.y + PROJECTION.tileH },
    { x: top.x - PROJECTION.halfW, y: top.y + PROJECTION.halfH },
  ];
}

export function projectedBounds(map, origin = defaultOrigin(map)) {
  const corners = [
    projectWorld(0, 0, 0, origin),
    projectWorld(map.width, 0, 0, origin),
    projectWorld(0, map.height, 0, origin),
    projectWorld(map.width, map.height, 0, origin),
  ];
  return corners.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
}
