import { pointInTile } from "./terrain-draw-geometry.js";

export function drawTerrainDecals(ctx, tile, corners, tick, now) {
  if (tile.material === "water") {
    const shimmer = ((tile.x * 11 + tile.y * 7 + tick + now / 52) % 60) / 60;
    if (shimmer < 0.42) {
      const point = pointInTile(corners, 0.24 + shimmer * 0.58, 0.4);
      ctx.beginPath();
      ctx.ellipse(point.x, point.y, 8, 1.8, -0.25, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(219, 242, 238, 0.22)";
      ctx.fill();
    }
    return;
  }

  for (const decal of tile.decals ?? []) {
    drawGroundDecal(ctx, tile, corners, decal);
  }
}

function drawGroundDecal(ctx, tile, corners, decal) {
  const point = pointInTile(corners, decal.u, decal.v);
  const size = Math.max(1.2, decal.size ?? 3);
  const zone = tile.composition?.zone;
  if (decal.kind === "crack") {
    ctx.save();
    ctx.strokeStyle = "rgba(35, 31, 27, 0.28)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(point.x - size * 1.5, point.y - size * 0.25);
    ctx.lineTo(point.x - size * 0.25, point.y + size * 0.15);
    ctx.lineTo(point.x + size * 0.85, point.y - size * 0.2);
    ctx.moveTo(point.x - size * 0.1, point.y + size * 0.1);
    ctx.lineTo(point.x + size * 0.28, point.y + size * 0.75);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (decal.kind === "moss") {
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(((tile.x * 13 + tile.y * 19) % 11 - 5) * 0.06);
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 1.45, size * 0.58, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(67, 104, 58, 0.25)";
    ctx.fill();
    ctx.restore();
    return;
  }
  if (decal.kind === "masonry-joint") {
    ctx.save();
    ctx.strokeStyle = "rgba(37, 35, 30, 0.22)";
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.moveTo(point.x - size * 1.8, point.y);
    ctx.lineTo(point.x + size * 1.8, point.y);
    ctx.moveTo(point.x - size * 0.4, point.y - size * 0.9);
    ctx.lineTo(point.x - size * 0.4, point.y + size * 0.9);
    ctx.moveTo(point.x + size * 0.9, point.y - size * 0.75);
    ctx.lineTo(point.x + size * 0.9, point.y + size * 0.75);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (decal.kind === "pebble" || zone === "road" || zone === "ridge") {
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(((tile.x * 17 + tile.y * 11) % 9 - 4) * 0.08);
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 1.4, size * 0.62, 0, 0, Math.PI * 2);
    ctx.fillStyle = zone === "road" ? "rgba(71, 55, 42, 0.25)" : "rgba(62, 65, 58, 0.34)";
    ctx.fill();
    ctx.strokeStyle = "rgba(24, 27, 23, 0.16)";
    ctx.lineWidth = 0.45;
    ctx.stroke();
    ctx.restore();
    return;
  }

  const blades = decal.kind === "tuft" ? 4 : 3;
  ctx.save();
  ctx.strokeStyle = zone === "shore" ? "rgba(63, 104, 76, 0.34)" : "rgba(43, 83, 38, 0.3)";
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  for (let blade = 0; blade < blades; blade += 1) {
    const offset = (blade - (blades - 1) / 2) * size * 0.56;
    ctx.moveTo(point.x + offset, point.y + size * 0.65);
    ctx.lineTo(point.x + offset * 0.55, point.y - size * (0.65 + blade * 0.06));
  }
  ctx.stroke();
  ctx.restore();
}
