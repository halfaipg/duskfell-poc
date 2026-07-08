import { drawDetailShadow } from "./terrain-detail-shadow.js";

export function drawTerrainGroundDetail(ctx, detail, point) {
  const scale = detail.scale;
  drawDetailShadow(ctx, point, 10 * scale, 3.5 * scale, detail.kind === "pebble" ? 0.16 : 0.1);

  if (detail.kind === "pebble") {
    drawPebbleCluster(ctx, point, scale, detail.shade);
    return;
  }
  if (detail.kind === "flower") {
    drawGrassTuft(ctx, point, scale, true, detail.shade);
    return;
  }
  drawGrassTuft(ctx, point, scale, false, detail.shade);
}

export function drawTerrainReedsDetail(ctx, detail, point) {
  const scale = detail.scale;
  drawDetailShadow(ctx, point, 12 * scale, 4 * scale, 0.16);
  ctx.save();
  ctx.strokeStyle = "rgba(58, 94, 61, 0.78)";
  ctx.lineWidth = Math.max(1, 1.2 * scale);
  ctx.beginPath();
  for (let reed = -3; reed <= 3; reed += 1) {
    const baseX = point.x + reed * 3 * scale;
    const topX = baseX + (detail.shade * 2 + reed * 0.4) * scale;
    ctx.moveTo(baseX, point.y + 5 * scale);
    ctx.lineTo(topX, point.y - (13 + Math.abs(reed)) * scale);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(126, 104, 61, 0.82)";
  for (let reed = -2; reed <= 2; reed += 2) {
    ctx.beginPath();
    ctx.ellipse(point.x + reed * 3 * scale, point.y - 10 * scale, 1.5 * scale, 4.5 * scale, -0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPebbleCluster(ctx, point, scale, shade) {
  const count = 2 + Math.floor(Math.abs(shade) * 3);
  for (let index = 0; index < count; index += 1) {
    const dx = (index - 1) * 4.2 * scale;
    const dy = ((index % 2) - 0.5) * 3 * scale;
    ctx.beginPath();
    ctx.ellipse(point.x + dx, point.y + dy, 3.4 * scale, 2.2 * scale, -0.35, 0, Math.PI * 2);
    ctx.fillStyle = index % 2 === 0 ? "rgba(80, 78, 68, 0.86)" : "rgba(113, 103, 82, 0.82)";
    ctx.fill();
    ctx.strokeStyle = "rgba(32, 31, 27, 0.32)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function drawGrassTuft(ctx, point, scale, flowers, shade) {
  ctx.strokeStyle = flowers ? "rgba(71, 112, 46, 0.72)" : "rgba(50, 87, 39, 0.68)";
  ctx.lineWidth = Math.max(1, 1.6 * scale);
  ctx.beginPath();
  for (let blade = -2; blade <= 2; blade += 1) {
    const lean = (blade * 2.6 + shade * 2) * scale;
    ctx.moveTo(point.x + blade * 2.8 * scale, point.y + 5 * scale);
    ctx.lineTo(point.x + lean, point.y - (6 + Math.abs(blade)) * scale);
  }
  ctx.stroke();

  if (!flowers) return;
  ctx.fillStyle = "rgba(226, 210, 132, 0.86)";
  for (let flower = 0; flower < 2; flower += 1) {
    ctx.beginPath();
    ctx.arc(point.x + (flower * 5 - 2.5) * scale, point.y - (5 + flower) * scale, 1.5 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}
