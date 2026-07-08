import { PLAYER_RENDER_SCALE } from "./player-config.js";
import { stableIndex } from "./player-draw-utils.js";

export function drawFallbackPlayer(ctx, point, color, isMe, motion, now, playerKey, grounding = null) {
  const phase = motion.moving
    ? (now - motion.walkStartMs) / 180 + stableIndex(playerKey) * 0.27
    : 0;
  const stride = motion.moving ? Math.sin(phase) : 0;
  const counterStride = motion.moving ? Math.sin(phase + Math.PI) : 0;
  const bob = motion.moving ? Math.sin(phase * 2) * 1.1 : 0;
  const cloakSway = motion.moving ? Math.sin(phase * 0.7) * 1.6 : 0;

  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.scale(PLAYER_RENDER_SCALE, PLAYER_RENDER_SCALE);
  const x = 0;
  const y = bob + (grounding?.bodyOffsetY ?? 0);

  ctx.beginPath();
  ctx.ellipse(x, 29, 22, 7, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(11, 15, 17, 0.28)";
  ctx.fill();

  ctx.fillStyle = "#252b2d";
  ctx.fillRect(x - 12 + stride * 2, y + 21, 8, 25);
  ctx.fillRect(x + 4 + counterStride * 2, y + 21, 8, 25);
  ctx.fillStyle = "#151b1f";
  ctx.fillRect(x - 17 + stride * 3, y + 44, 14, 6);
  ctx.fillRect(x + 2 + counterStride * 3, y + 44, 14, 6);

  ctx.fillStyle = "#18252b";
  ctx.beginPath();
  ctx.moveTo(x - 23 + cloakSway, y - 12);
  ctx.lineTo(x - 17 + cloakSway * 0.4, y + 43);
  ctx.lineTo(x, y + 35);
  ctx.lineTo(x + 17 + cloakSway * 0.4, y + 43);
  ctx.lineTo(x + 23 + cloakSway, y - 12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(7, 11, 13, 0.55)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = shadePlayerColor(color, 0.84);
  ctx.fillRect(x - 15, y - 9, 30, 35);
  ctx.fillStyle = "rgba(192, 188, 163, 0.55)";
  for (let chain = -9; chain <= 9; chain += 6) {
    ctx.fillRect(x + chain, y - 2, 2, 18);
  }
  ctx.fillStyle = "#a87942";
  ctx.fillRect(x - 9, y + 14, 18, 5);
  ctx.fillStyle = "#6f472d";
  ctx.fillRect(x - 4, y + 18, 8, 20);

  ctx.fillStyle = "#b99168";
  ctx.beginPath();
  ctx.ellipse(x, y - 23, 12, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#697171";
  ctx.fillRect(x - 14, y - 35, 28, 8);
  ctx.beginPath();
  ctx.moveTo(x - 17, y - 31);
  ctx.lineTo(x, y - 48);
  ctx.lineTo(x + 17, y - 31);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#d7c693";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 36);
  ctx.lineTo(x, y - 16);
  ctx.stroke();
  ctx.fillStyle = "#f0e2bb";
  ctx.beginPath();
  ctx.arc(x - 5, y - 23, 2.2, 0, Math.PI * 2);
  ctx.arc(x + 5, y - 23, 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#5d4936";
  ctx.fillRect(x - 35 - stride * 2, y - 4, 15, 29);
  ctx.fillStyle = "#34404a";
  ctx.beginPath();
  ctx.ellipse(x - 31 - stride * 2, y + 11, 11, 17, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#b49a62";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.strokeStyle = "#d7c693";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 23 + counterStride, y - 5);
  ctx.lineTo(x + 39 + counterStride, y - 38);
  ctx.lineTo(x + 45 + counterStride, y - 24);
  ctx.moveTo(x + 39 + counterStride, y - 38);
  ctx.lineTo(x + 34 + counterStride, y - 31);
  ctx.stroke();

  ctx.restore();
}

function shadePlayerColor(color, factor) {
  const match = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const hex = match[1];
  const channels = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return `rgb(${channels.map((channel) => Math.round(channel * factor)).join(", ")})`;
}
