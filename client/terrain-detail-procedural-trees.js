import { drawDetailShadow } from "./terrain-detail-shadow.js";

export function drawTerrainTreeDetail(ctx, detail, point) {
  const scale = detail.scale;
  drawDetailShadow(ctx, point, 30 * scale, 11 * scale, 0.34);

  const trunkHeight = 28 * scale;
  const sway = detail.shade * 3 * scale;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(55, 39, 27, 0.92)";
  ctx.lineWidth = Math.max(3, 5.6 * scale);
  ctx.beginPath();
  ctx.moveTo(point.x, point.y + 3 * scale);
  ctx.lineTo(point.x + sway * 0.4, point.y - trunkHeight);
  ctx.stroke();
  ctx.strokeStyle = "rgba(32, 24, 19, 0.46)";
  ctx.lineWidth = Math.max(1, 1.8 * scale);
  ctx.beginPath();
  ctx.moveTo(point.x - 5 * scale, point.y - 9 * scale);
  ctx.lineTo(point.x + sway - 13 * scale, point.y - 33 * scale);
  ctx.moveTo(point.x + 4 * scale, point.y - 14 * scale);
  ctx.lineTo(point.x + sway + 13 * scale, point.y - 37 * scale);
  ctx.stroke();

  const crown = {
    x: point.x + sway,
    y: point.y - trunkHeight - 21 * scale,
  };
  const lobes = [
    [-15, 1, 18, 24, -0.35, "rgba(31, 68, 45, 0.98)"],
    [1, -12, 22, 30, 0.04, "rgba(54, 99, 57, 0.98)"],
    [17, 1, 18, 24, 0.34, "rgba(25, 58, 42, 0.99)"],
    [-4, 12, 25, 22, 0.02, "rgba(36, 78, 48, 0.98)"],
    [0, -29, 15, 17, -0.1, "rgba(73, 118, 64, 0.95)"],
  ];
  for (const [dx, dy, rx, ry, rotation, fill] of lobes) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(
      crown.x + dx * scale,
      crown.y + dy * scale,
      rx * scale,
      ry * scale,
      rotation,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.fillStyle = "rgba(136, 156, 88, 0.22)";
  ctx.beginPath();
  ctx.ellipse(crown.x - 10 * scale, crown.y - 19 * scale, 9 * scale, 6 * scale, -0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(8, 23, 20, 0.28)";
  ctx.beginPath();
  ctx.ellipse(crown.x + 14 * scale, crown.y + 17 * scale, 14 * scale, 10 * scale, 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
