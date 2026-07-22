import { interiorOccupancy } from "./interior-occlusion.js";
import { PROJECTION, projectMap } from "./projection.js";

export function createInteriorRenderer({ getContext, getTerrain }) {
  function drawInteriorRoofs(origin, playerPosition, now) {
    const terrain = getTerrain();
    if (!terrain?.interiorSpaces?.length) return;
    for (const space of terrain.interiorSpaces) {
      const occupancy = interiorOccupancy(space, playerPosition);
      if (occupancy.inside) {
        const corners = projectedBounds(space.bounds, space.roof?.z ?? 2, origin, terrain.profile?.unitsPerTile ?? PROJECTION.unitsPerTile);
        const flicker = Math.sin(now * 0.003 + stableStringHash(space.id) * 0.01) * 0.5 + 0.5;
        drawInteriorReveal(space, corners, origin, occupancy, terrain.profile?.unitsPerTile ?? PROJECTION.unitsPerTile, flicker);
      }
      for (const occluder of occupancy.occluders ?? []) drawInteriorRoof(space, occluder, origin, now);
    }
  }

  function drawInteriorRoof(space, occluder, origin, now) {
    const terrain = getTerrain();
    const ctx = getContext();
    const alpha = occluder.alpha;
    if (alpha <= 0) return;

    const units = terrain?.profile?.unitsPerTile ?? PROJECTION.unitsPerTile;
    const corners = projectedBounds(occluder.bounds ?? space.bounds, occluder.z ?? space.roof?.z ?? 2, origin, units);
    const flicker = Math.sin(now * 0.003 + stableStringHash(occluder.id) * 0.01) * 0.5 + 0.5;
    const revealed = occluder.revealed;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = revealed ? "rgba(118, 112, 96, 0.36)" : "rgba(83, 78, 68, 0.86)";
    ctx.strokeStyle = revealed ? "rgba(223, 214, 181, 0.28)" : "rgba(32, 28, 24, 0.72)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(corners.nw.x, corners.nw.y);
    ctx.lineTo(corners.ne.x, corners.ne.y);
    ctx.lineTo(corners.se.x, corners.se.y);
    ctx.lineTo(corners.sw.x, corners.sw.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = alpha * (revealed ? 0.38 : 0.68);
    ctx.strokeStyle = revealed ? "rgba(150, 198, 190, 0.45)" : "rgba(179, 167, 133, 0.52)";
    ctx.lineWidth = 1;
    const ribs = 4;
    for (let rib = 1; rib < ribs; rib += 1) {
      const t = rib / ribs;
      const a = lerpPoint(corners.nw, corners.ne, t);
      const b = lerpPoint(corners.sw, corners.se, t);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.globalAlpha = alpha * (0.12 + flicker * 0.12);
    ctx.strokeStyle = "rgba(120, 229, 232, 0.75)";
    ctx.lineWidth = 1.2;
    const midNorth = lerpPoint(corners.nw, corners.ne, 0.5);
    const midSouth = lerpPoint(corners.sw, corners.se, 0.5);
    ctx.beginPath();
    ctx.moveTo(midNorth.x, midNorth.y);
    ctx.lineTo((midNorth.x + midSouth.x) / 2 + 7, (midNorth.y + midSouth.y) / 2 - 3);
    ctx.lineTo(midSouth.x, midSouth.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawInteriorReveal(space, roofCorners, origin, occupancy, units, flicker) {
    const ctx = getContext();
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = "rgba(174, 158, 124, 0.2)";
    ctx.strokeStyle = "rgba(225, 211, 170, 0.4)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(roofCorners.nw.x, roofCorners.nw.y + 18);
    ctx.lineTo(roofCorners.ne.x, roofCorners.ne.y + 18);
    ctx.lineTo(roofCorners.se.x, roofCorners.se.y + 18);
    ctx.lineTo(roofCorners.sw.x, roofCorners.sw.y + 18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const inset = 0.18;
    const bounds = space.bounds;
    const minX = bounds.minX / units;
    const maxX = bounds.maxX / units;
    const minY = bounds.minY / units;
    const maxY = bounds.maxY / units;
    const gallery = {
      nw: projectMap(minX + inset, minY + inset, space.floors?.[1]?.z ?? 1.15, origin),
      ne: projectMap(maxX - inset, minY + inset, space.floors?.[1]?.z ?? 1.15, origin),
      se: projectMap(maxX - inset, maxY - inset, space.floors?.[1]?.z ?? 1.15, origin),
      sw: projectMap(minX + inset, maxY - inset, space.floors?.[1]?.z ?? 1.15, origin),
    };
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = "rgba(105, 223, 224, 0.42)";
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(gallery.nw.x, gallery.nw.y);
    ctx.lineTo(gallery.ne.x, gallery.ne.y);
    ctx.lineTo(gallery.se.x, gallery.se.y);
    ctx.lineTo(gallery.sw.x, gallery.sw.y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    for (const portal of space.portals ?? []) {
      drawInteriorPortal(portal, origin, units, occupancy.portal?.id === portal.id, flicker);
    }
    ctx.restore();
  }

  function drawInteriorPortal(portal, origin, units, active, flicker) {
    const bounds = portal.bounds;
    if (!bounds) return;
    const ctx = getContext();
    const minX = bounds.minX / units;
    const maxX = bounds.maxX / units;
    const minY = bounds.minY / units;
    const maxY = bounds.maxY / units;
    const z = portal.fromZ ?? 0;
    const corners = {
      nw: projectMap(minX, minY, z, origin),
      ne: projectMap(maxX, minY, z, origin),
      se: projectMap(maxX, maxY, z, origin),
      sw: projectMap(minX, maxY, z, origin),
    };
    ctx.globalAlpha = active ? 0.55 + flicker * 0.16 : 0.34;
    ctx.fillStyle = active ? "rgba(97, 220, 222, 0.18)" : "rgba(77, 63, 48, 0.2)";
    ctx.strokeStyle = active ? "rgba(134, 238, 238, 0.62)" : "rgba(209, 184, 130, 0.42)";
    ctx.lineWidth = active ? 1.8 : 1.1;
    ctx.beginPath();
    ctx.moveTo(corners.nw.x, corners.nw.y);
    ctx.lineTo(corners.ne.x, corners.ne.y);
    ctx.lineTo(corners.se.x, corners.se.y);
    ctx.lineTo(corners.sw.x, corners.sw.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = active ? 0.72 : 0.42;
    ctx.strokeStyle = active ? "rgba(154, 239, 235, 0.72)" : "rgba(96, 75, 51, 0.62)";
    for (let step = 1; step <= 3; step += 1) {
      const t = step / 4;
      const a = lerpPoint(corners.nw, corners.sw, t);
      const b = lerpPoint(corners.ne, corners.se, t);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  return {
    drawInteriorRoofs,
  };
}

function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function projectedBounds(bounds, z, origin, units) {
  const minX = bounds.minX / units;
  const maxX = bounds.maxX / units;
  const minY = bounds.minY / units;
  const maxY = bounds.maxY / units;
  return {
    nw: projectMap(minX, minY, z, origin),
    ne: projectMap(maxX, minY, z, origin),
    se: projectMap(maxX, maxY, z, origin),
    sw: projectMap(minX, maxY, z, origin),
  };
}

function stableStringHash(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}
