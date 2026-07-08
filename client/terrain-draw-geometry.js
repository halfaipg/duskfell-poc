export function edgePoints(corners, edge) {
  switch (edge) {
    case "north":
      return [corners.nw, corners.ne];
    case "east":
      return [corners.ne, corners.se];
    case "south":
      return [corners.se, corners.sw];
    case "west":
      return [corners.sw, corners.nw];
    default:
      return [corners.nw, corners.ne];
  }
}

export function edgeBandPoints(corners, edge, depth = 0.34) {
  const inset = 1 - depth;
  switch (edge) {
    case "north":
      return [corners.nw, corners.ne, pointInTile(corners, 0.78, depth), pointInTile(corners, 0.22, depth)];
    case "east":
      return [corners.ne, corners.se, pointInTile(corners, inset, 0.78), pointInTile(corners, inset, 0.22)];
    case "south":
      return [corners.se, corners.sw, pointInTile(corners, 0.22, inset), pointInTile(corners, 0.78, inset)];
    case "west":
      return [corners.sw, corners.nw, pointInTile(corners, depth, 0.22), pointInTile(corners, depth, 0.78)];
    default:
      return [corners.nw, corners.ne, pointInTile(corners, 0.78, depth), pointInTile(corners, 0.22, depth)];
  }
}

export function cornerBandPoints(corners, corner, depth = 0.3) {
  const inset = Math.max(0.08, Math.min(0.48, depth));
  switch (corner) {
    case "northEast":
      return [corners.ne, pointInTile(corners, 1 - inset, 0), pointInTile(corners, 1, inset), pointInTile(corners, 1 - inset, inset)];
    case "southEast":
      return [corners.se, pointInTile(corners, 1, 1 - inset), pointInTile(corners, 1 - inset, 1), pointInTile(corners, 1 - inset, 1 - inset)];
    case "southWest":
      return [corners.sw, pointInTile(corners, inset, 1), pointInTile(corners, 0, 1 - inset), pointInTile(corners, inset, 1 - inset)];
    case "northWest":
      return [corners.nw, pointInTile(corners, 0, inset), pointInTile(corners, inset, 0), pointInTile(corners, inset, inset)];
    default:
      return [corners.nw, pointInTile(corners, 0, inset), pointInTile(corners, inset, 0), pointInTile(corners, inset, inset)];
  }
}

export function pointInTile(corners, u, v) {
  return {
    x:
      corners.nw.x * (1 - u) * (1 - v) +
      corners.ne.x * u * (1 - v) +
      corners.se.x * u * v +
      corners.sw.x * (1 - u) * v,
    y:
      corners.nw.y * (1 - u) * (1 - v) +
      corners.ne.y * u * (1 - v) +
      corners.se.y * u * v +
      corners.sw.y * (1 - u) * v,
  };
}

export function clipTile(ctx, corners) {
  ctx.beginPath();
  ctx.moveTo(corners.nw.x, corners.nw.y);
  ctx.lineTo(corners.ne.x, corners.ne.y);
  ctx.lineTo(corners.se.x, corners.se.y);
  ctx.lineTo(corners.sw.x, corners.sw.y);
  ctx.closePath();
  ctx.clip();
}

export function tileBounds(corners) {
  return {
    minX: Math.min(corners.nw.x, corners.ne.x, corners.se.x, corners.sw.x),
    maxX: Math.max(corners.nw.x, corners.ne.x, corners.se.x, corners.sw.x),
    minY: Math.min(corners.nw.y, corners.ne.y, corners.se.y, corners.sw.y),
    maxY: Math.max(corners.nw.y, corners.ne.y, corners.se.y, corners.sw.y),
  };
}

export function bandCenter(points) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

export function stableStringHash(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function tintWithAlpha(hex, alpha) {
  const normalized = hex.startsWith("#") ? hex.slice(1) : hex;
  if (normalized.length !== 6) return `rgba(10, 12, 11, ${alpha})`;
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
