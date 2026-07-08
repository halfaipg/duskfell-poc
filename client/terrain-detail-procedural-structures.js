import { drawDetailShadow } from "./terrain-detail-shadow.js";

export function drawTerrainRuinDetail(ctx, detail, point) {
  const scale = detail.scale;
  drawDetailShadow(ctx, point, 30 * scale, 12 * scale, 0.3);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(detail.shade * 0.08);

  ctx.fillStyle = "rgba(92, 89, 76, 0.92)";
  ctx.strokeStyle = "rgba(28, 29, 25, 0.5)";
  ctx.lineWidth = Math.max(1, 1.4 * scale);
  for (const block of [
    [-20, -11, 16, 14],
    [-4, -16, 18, 19],
    [14, -8, 12, 12],
    [-14, 4, 28, 9],
  ]) {
    ctx.fillRect(block[0] * scale, block[1] * scale, block[2] * scale, block[3] * scale);
    ctx.strokeRect(block[0] * scale, block[1] * scale, block[2] * scale, block[3] * scale);
  }
  ctx.fillStyle = "rgba(188, 176, 130, 0.2)";
  ctx.fillRect(-18 * scale, -10 * scale, 9 * scale, 3 * scale);
  ctx.restore();
}

export function drawTerrainWallDetail(ctx, detail, point) {
  const scale = detail.scale;
  const role = detail.kitRole ?? "";
  const vertical = role === "wall-east" || role === "wall-west";
  const width = (vertical ? 38 : 66) * scale;
  const height = (vertical ? 58 : 52) * scale;
  const depth = (vertical ? 22 : 16) * scale;
  const baseDrop = 12 * scale;
  const decay = clamp(detail.lifecycle?.decay ?? 0.5, 0, 1);
  const lean = (detail.shade ?? 0) * 3 * scale;

  drawDetailShadow(ctx, { x: point.x, y: point.y + 7 * scale }, width * 0.62, 11 * scale, 0.38);
  ctx.save();
  ctx.translate(point.x, point.y);

  const left = -width / 2 + lean;
  const right = width / 2 + lean;
  const top = -height;
  const broken = decay * 7 * scale;

  ctx.fillStyle = "rgba(98, 91, 78, 0.98)";
  ctx.strokeStyle = "rgba(33, 31, 27, 0.54)";
  ctx.lineWidth = Math.max(1, 1.1 * scale);
  ctx.beginPath();
  ctx.moveTo(left, -depth);
  ctx.lineTo(right, -depth);
  ctx.lineTo(right - 5 * scale, top + broken);
  ctx.lineTo(left + 7 * scale, top + broken * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(71, 66, 57, 0.98)";
  ctx.beginPath();
  ctx.moveTo(left, -depth);
  ctx.lineTo(right, -depth);
  ctx.lineTo(right - 2 * scale, baseDrop);
  ctx.lineTo(left + 2 * scale, baseDrop);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(139, 128, 102, 0.96)";
  ctx.beginPath();
  ctx.moveTo(left + 7 * scale, top + broken * 0.45);
  ctx.lineTo(right - 5 * scale, top + broken);
  ctx.lineTo(right, -depth);
  ctx.lineTo(left, -depth);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(49, 47, 41, 0.45)";
  ctx.beginPath();
  ctx.moveTo(right, -depth);
  ctx.lineTo(right - 5 * scale, top + broken);
  ctx.lineTo(right + 3 * scale, top + broken + 10 * scale);
  ctx.lineTo(right - 2 * scale, baseDrop);
  ctx.closePath();
  ctx.fill();

  drawMasonryJoints(ctx, left, right, top + broken, baseDrop, scale, decay);
  drawWallMossAndCracks(ctx, left, right, top, depth, scale, decay);
  ctx.restore();
}

export function drawTerrainStairsDetail(ctx, detail, point) {
  const scale = detail.scale;
  const decay = clamp(detail.lifecycle?.decay ?? 0.55, 0, 1);
  drawDetailShadow(ctx, point, 29 * scale, 10 * scale, 0.26);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.strokeStyle = "rgba(37, 34, 29, 0.46)";
  ctx.lineWidth = Math.max(1, scale);
  for (let step = 0; step < 5; step += 1) {
    const y = (step * 6 - 26) * scale;
    const width = (48 - step * 5) * scale;
    const chip = (step % 2) * decay * 4 * scale;
    ctx.fillStyle = step % 2 === 0 ? "rgba(145, 135, 108, 0.94)" : "rgba(111, 104, 87, 0.94)";
    ctx.beginPath();
    ctx.moveTo(-width / 2 + chip, y);
    ctx.lineTo(width / 2, y);
    ctx.lineTo(width / 2 - 7 * scale, y + 6 * scale);
    ctx.lineTo(-width / 2 - 7 * scale + chip, y + 6 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 0.26 + decay * 0.22;
  ctx.strokeStyle = "rgba(50, 44, 36, 0.72)";
  ctx.beginPath();
  ctx.moveTo(-19 * scale, -18 * scale);
  ctx.lineTo(-6 * scale, -10 * scale);
  ctx.lineTo(-13 * scale, -2 * scale);
  ctx.moveTo(14 * scale, -13 * scale);
  ctx.lineTo(4 * scale, -4 * scale);
  ctx.stroke();
  ctx.restore();
}

export function drawTerrainFoundationDetail(ctx, detail, point) {
  const scale = detail.scale;
  const decay = clamp(detail.lifecycle?.decay ?? 0.6, 0, 1);
  drawDetailShadow(ctx, point, 24 * scale, 7 * scale, 0.18);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate((detail.shade ?? 0) * 0.05);
  ctx.fillStyle = "rgba(112, 105, 87, 0.84)";
  ctx.strokeStyle = "rgba(35, 32, 27, 0.32)";
  ctx.lineWidth = Math.max(0.8, 0.8 * scale);
  for (let block = 0; block < 5; block += 1) {
    const x = (block - 2) * 9 * scale;
    const y = ((block % 2) * 5 - 6) * scale;
    const width = (10 + (block % 2) * 3) * scale;
    const height = (7 + decay * 3) * scale;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
  }
  ctx.globalAlpha = 0.18 + decay * 0.24;
  ctx.fillStyle = "rgba(69, 105, 57, 0.8)";
  ctx.beginPath();
  ctx.ellipse(-8 * scale, 5 * scale, 10 * scale, 3 * scale, -0.2, 0, Math.PI * 2);
  ctx.ellipse(13 * scale, 2 * scale, 7 * scale, 2.4 * scale, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMasonryJoints(ctx, left, right, top, bottom, scale, decay) {
  ctx.save();
  ctx.globalAlpha = 0.28 + decay * 0.18;
  ctx.strokeStyle = "rgba(37, 34, 28, 0.72)";
  ctx.lineWidth = Math.max(0.7, 0.7 * scale);
  for (let row = 0; row < 4; row += 1) {
    const y = top + ((bottom - top) * (row + 1)) / 5;
    ctx.beginPath();
    ctx.moveTo(left + 2 * scale, y);
    ctx.lineTo(right - 2 * scale, y + (row % 2 ? 0.8 : -0.5) * scale);
    ctx.stroke();
  }
  for (let col = 0; col < 5; col += 1) {
    const x = left + ((right - left) * (col + 0.5 + (col % 2) * 0.35)) / 6;
    ctx.beginPath();
    ctx.moveTo(x, top + 3 * scale);
    ctx.lineTo(x + 0.8 * scale, bottom - 1 * scale);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWallMossAndCracks(ctx, left, right, top, depth, scale, decay) {
  ctx.save();
  ctx.globalAlpha = 0.14 + decay * 0.28;
  ctx.strokeStyle = "rgba(48, 43, 34, 0.86)";
  ctx.lineWidth = Math.max(0.8, 0.85 * scale);
  ctx.beginPath();
  ctx.moveTo(left + 16 * scale, top + 8 * scale);
  ctx.lineTo(left + 25 * scale, top + 18 * scale);
  ctx.lineTo(left + 20 * scale, top + 29 * scale);
  ctx.moveTo(right - 18 * scale, top + 11 * scale);
  ctx.lineTo(right - 25 * scale, top + 22 * scale);
  ctx.stroke();

  ctx.globalAlpha = 0.16 + decay * 0.24;
  ctx.fillStyle = "rgba(74, 106, 58, 0.82)";
  ctx.beginPath();
  ctx.ellipse(left + 13 * scale, -depth - 1 * scale, 10 * scale, 3.8 * scale, -0.2, 0, Math.PI * 2);
  ctx.ellipse(right - 16 * scale, -depth + 1 * scale, 8 * scale, 3.4 * scale, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
