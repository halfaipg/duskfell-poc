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

  drawPlayerSpeech(ctx, player, point, labelOffsetY);

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

// UO-style overhead speech: word-wrapped lines float above the head in the
// speaker's colour, outlined so they read over any terrain
const SPEECH_LINE_CHARS = 26;
const SPEECH_MAX_LINES = 4;

function drawPlayerSpeech(ctx, player, point, labelOffsetY) {
  const text = player.speech?.text;
  if (!text) return;
  const lines = wrapSpeech(text);
  ctx.save();
  ctx.font = "700 14px system-ui";
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  const baseY = point.y + labelOffsetY - 12 - (lines.length - 1) * 16;
  lines.forEach((line, index) => {
    const y = baseY + index * 16;
    ctx.strokeStyle = "rgba(17, 20, 23, 0.85)";
    ctx.strokeText(line, point.x, y);
    ctx.fillStyle = player.color || "#f5efdc";
    ctx.fillText(line, point.x, y);
  });
  ctx.restore();
}

function wrapSpeech(text) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > SPEECH_LINE_CHARS && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, SPEECH_MAX_LINES);
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
