import { ITEM_ICON_FRAMES } from "./player-config.js";

export function drawObjectResourceMeter(ctx, sprites, object, point) {
  const resource = object.resources?.[0];
  if (!resource || resource.maxAmount <= 0) return;

  const fullness = Math.max(0, Math.min(1, resource.amount / resource.maxAmount));
  const width = 36;
  const height = 5;
  const x = Math.round(point.x - width / 2);
  const y = Math.round(point.y + 54);
  const color = resourceMeterColor(resource.kind, object.lifecycle);

  ctx.save();
  ctx.fillStyle = "rgba(12, 15, 13, 0.48)";
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.round(width * fullness), height);
  ctx.strokeStyle = "rgba(246, 239, 217, 0.45)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

  const icon = resource.kind === "mycelium" || resource.kind === "spores" ? "deed" : resource.kind;
  drawWorldItemIcon(ctx, sprites, icon, point.x + 24, point.y + 55, 0.28);
  ctx.restore();
}

export function resourceMeterColor(kind, lifecycle) {
  if (kind === "ore") return "#a8aaa0";
  if (kind === "stone") return lifecycle?.stage === "ancient-ruin" ? "#9d967f" : "#b8b3a0";
  if (kind === "charge") return lifecycle?.stage === "spent" ? "#718489" : "#8ee7ee";
  if (kind === "mycelium" || kind === "spores") return lifecycle?.stage === "dormant" ? "#8f82b8" : "#c3a7d6";
  if (kind === "fiber" || kind === "seed") return "#9fb36b";
  if (kind === "deadwood") return "#8f6b49";
  return lifecycle?.stage === "cut" ? "#a3764e" : "#6d9254";
}

export function drawWorldItemIcon(ctx, sprites, itemId, x, y, scale) {
  const frame = ITEM_ICON_FRAMES[itemId];
  const sprite = sprites.items;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y + 9 * scale, 19 * scale, 7 * scale, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(10, 13, 12, 0.24)";
  ctx.fill();

  if (sprite?.image?.complete && frame != null && frame < sprite.frameCount) {
    const sourceFrame = (sprite.startFrame ?? 0) + frame;
    const size = Math.round(sprite.cellWidth * scale);
    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sprite.image,
      (sourceFrame % sprite.columns) * sprite.cellWidth,
      Math.floor(sourceFrame / sprite.columns) * sprite.cellHeight,
      sprite.cellWidth,
      sprite.cellHeight,
      Math.round(x - size / 2),
      Math.round(y - size + 7),
      size,
      size,
    );
    ctx.imageSmoothingEnabled = previousSmoothing;
  } else {
    ctx.fillStyle = "#d5c18a";
    ctx.fillRect(x - 8 * scale, y - 14 * scale, 16 * scale, 16 * scale);
    ctx.strokeStyle = "#2a302f";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 8 * scale, y - 14 * scale, 16 * scale, 16 * scale);
  }

  ctx.restore();
}
