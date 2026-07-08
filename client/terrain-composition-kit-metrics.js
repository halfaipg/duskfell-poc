export function stormrootMetrics(x, y, kit) {
  const dx = x + 0.5 - kit.x;
  const dy = y + 0.5 - kit.y;
  const distance = Math.hypot(dx, dy);
  const along = (dx + dy) / Math.SQRT2;
  const across = (dx - dy) / Math.SQRT2;
  const inChargedCore = distance <= kit.coreRadius;
  const onWireScar = distance <= kit.radius && Math.abs(across) <= kit.wireWidth && Math.abs(along) <= kit.radius * 0.95;
  const inRotRing = distance > kit.coreRadius && distance <= kit.radius * 0.72;
  const inOuterRoot = distance <= kit.radius;
  return { dx, dy, distance, along, across, inChargedCore, onWireScar, inRotRing, inOuterRoot };
}

export function leywellMetrics(x, y, kit) {
  const dx = x + 0.5 - kit.x;
  const dy = y + 0.5 - kit.y;
  const distance = Math.hypot(dx, dy);
  const along = (dx - dy) / Math.SQRT2;
  const across = (dx + dy) / Math.SQRT2;
  const inBasin = distance <= kit.basinRadius;
  const onConduit = distance <= kit.radius && Math.abs(across) <= kit.conduitWidth && along > -kit.radius * 0.72;
  const inWetGarden = distance > kit.basinRadius && distance <= kit.radius * 0.74;
  const inFallenRim = distance <= kit.radius;
  return { dx, dy, distance, along, across, inBasin, onConduit, inWetGarden, inFallenRim };
}

export function gatehouseMetrics(x, y, kit) {
  const dx = x + 0.5 - kit.x;
  const dy = y + 0.5 - kit.y;
  const insideWidth = Math.abs(dx) <= kit.halfWidth;
  const insideHeight = Math.abs(dy) <= kit.halfHeight;
  const inside = insideWidth && insideHeight;
  const inPassage = Math.abs(dx) <= kit.passageWidth && Math.abs(dy) <= kit.halfHeight + 0.86;
  const onWestTower = inside && dx < -kit.passageWidth && Math.abs(dx + kit.halfWidth * 0.68) <= 0.84;
  const onEastTower = inside && dx > kit.passageWidth && Math.abs(dx - kit.halfWidth * 0.68) <= 0.84;
  const onTower = onWestTower || onEastTower;
  const inThreshold = Math.abs(dx) <= kit.passageWidth + 0.42 && Math.abs(dy - kit.halfHeight) <= kit.thresholdDepth;
  const inRubble = Math.abs(dx) <= kit.halfWidth + 1.2 && Math.abs(dy) <= kit.halfHeight + 1.2;
  const towerRole = onWestTower ? "tower-west" : onEastTower ? "tower-east" : "tower";
  return { dx, dy, inside, inPassage, onTower, towerRole, inThreshold, inRubble };
}

export function viaductMetrics(x, y, kit) {
  const dx = x + 0.5 - kit.x;
  const dy = y + 0.5 - kit.y;
  const along = (dx - dy) / Math.SQRT2;
  const across = (dx + dy) / Math.SQRT2;
  const onCauseway = Math.abs(along) <= kit.length && Math.abs(across) <= kit.width;
  const inRubble = Math.hypot(dx, dy) <= kit.radius && Math.abs(across) <= kit.width + 2.6;
  return { along, across, onCauseway, inRubble };
}

export function courtyardMetrics(x, y, kit) {
  const dx = x + 0.5 - kit.x;
  const dy = y + 0.5 - kit.y;
  const halfWidth = kit.halfWidth;
  const halfHeight = kit.halfHeight;
  const withinWidth = Math.abs(dx) <= halfWidth;
  const withinHeight = Math.abs(dy) <= halfHeight;
  const inside = withinWidth && withinHeight;
  const onNorth = inside && Math.abs(dy + halfHeight) <= 0.62;
  const onSouth = inside && Math.abs(dy - halfHeight) <= 0.62;
  const onWest = inside && Math.abs(dx + halfWidth) <= 0.62;
  const onEast = inside && Math.abs(dx - halfWidth) <= 0.62;
  const onStairs = Math.abs(dx) <= 0.92 && dy > halfHeight - 0.72 && dy <= halfHeight + 1.24;
  const onWall = onNorth || onSouth || onWest || onEast;
  const inFloor = inside && !onWall;
  const inRubble = Math.abs(dx) <= halfWidth + 1.6 && Math.abs(dy) <= halfHeight + 1.6;
  const wallRole = onNorth ? "wall-north" : onSouth ? "wall-south" : onWest ? "wall-west" : onEast ? "wall-east" : "wall";
  return { dx, dy, onWall, wallRole, onStairs, inFloor, inRubble };
}
