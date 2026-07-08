import { ITEM_ICON_FRAMES, PLAYER_RENDER_SCALE } from "./player-config.js";
import { inventoryItemCount, playerDisplayName } from "./ui-panels.js";

export function playerLabelOffset(sprite) {
  if (!sprite) return -62;
  const scale = sprite.render?.scale ?? PLAYER_RENDER_SCALE;
  return -Math.max(48, sprite.anchor.y * scale + 8);
}

export function drawPlayerLabels(
  ctx,
  sprites,
  player,
  point,
  labelOffsetY = -62,
  sprite = null,
  showName = true,
) {
  if (showName) {
    ctx.fillStyle = "#111417";
    ctx.font = "700 16px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(playerDisplayName(player, sprite), point.x, point.y + labelOffsetY);
  }

  if (player.demoDeeds.length > 0) {
    ctx.fillStyle = "#f2d98b";
    ctx.fillRect(point.x - 13, point.y + 40, 26, 16);
    ctx.strokeStyle = "#7a5c25";
    ctx.lineWidth = 2;
    ctx.strokeRect(point.x - 13, point.y + 40, 26, 16);
  }

  const gathered = inventoryItemCount(player.inventory);
  if (gathered > 0) {
    drawInventoryBadge(ctx, sprites, player.inventory, point.x + 24, point.y + 44, gathered);
  }
}

function drawInventoryBadge(ctx, sprites, inventory, x, y, gathered) {
  const firstItem = inventory.items[0];
  const frame = firstItem ? ITEM_ICON_FRAMES[firstItem.itemId] : null;
  const sprite = sprites.items;

  ctx.save();
  ctx.fillStyle = "rgba(255, 253, 247, 0.92)";
  ctx.strokeStyle = "#2a302f";
  ctx.lineWidth = 2;
  ctx.fillRect(x - 13, y - 13, 26, 26);
  ctx.strokeRect(x - 13, y - 13, 26, 26);

  if (sprite?.image?.complete && frame != null && frame < sprite.frameCount) {
    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sprite.image,
      (frame % sprite.columns) * sprite.cellWidth,
      Math.floor(frame / sprite.columns) * sprite.cellHeight,
      sprite.cellWidth,
      sprite.cellHeight,
      x - 10,
      y - 12,
      20,
      20,
    );
    ctx.imageSmoothingEnabled = previousSmoothing;
  }

  ctx.fillStyle = "#2f7565";
  ctx.font = "800 11px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(String(Math.min(gathered, 99)), x + 7, y + 12);
  ctx.restore();
}
