import {
  DETAIL_SPRITE_FRAMES,
  DETAIL_SPRITE_SCALE,
} from "./player-config.js";
import { drawDetailShadow } from "./terrain-detail-procedural-draw.js";
import { drawCastShadow } from "./cast-shadow.js";

export function drawTerrainDetailSprite(ctx, sprites, cueDrawer, detail, point) {
  const sprite = sprites.details;
  if (!sprite?.image.complete || sprite.image.naturalWidth === 0) return false;
  const frame = detailSpriteFrame(detail);
  if (frame == null || frame >= sprite.frameCount) return false;

  const scale =
    (sprite.render?.scale ?? 1) *
    detail.scale *
    (DETAIL_SPRITE_SCALE[detail.kind] ?? 1);
  const sx = (sprite.startFrame + frame) * sprite.cellWidth;
  const dx = Math.round(point.x - sprite.anchor.x * scale);
  const dy = Math.round(point.y - sprite.anchor.y * scale);
  const dw = Math.round(sprite.cellWidth * scale);
  const dh = Math.round(sprite.cellHeight * scale);

  if (sprite.render?.shadow?.kind === "ellipse") {
    // sun-cast silhouette shadow (with a soft contact patch) instead of the
    // floating blob ellipse
    drawCastShadow(
      ctx,
      sprite.image,
      sx,
      0,
      sprite.cellWidth,
      sprite.cellHeight,
      { x: point.x, y: point.y },
      scale,
      `details:${frame}`,
      sprite.anchor.x,
    );
  }

  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sprite.image,
    sx,
    0,
    sprite.cellWidth,
    sprite.cellHeight,
    dx,
    dy,
    dw,
    dh,
  );
  ctx.imageSmoothingEnabled = previousSmoothing;
  cueDrawer.drawTerrainDetailLifecycleCues(detail, point, scale);
  return true;
}

export function drawTerrainRockDetail(ctx, sprites, detail, point) {
  const scale = Math.max(0.22, detail.scale * (detail.kind === "boulder" ? 1.05 : 0.74));
  drawDetailShadow(ctx, point, 18 * scale, 7 * scale, detail.kind === "boulder" ? 0.3 : 0.24);
  return drawPropFrame(ctx, sprites, 3, point, scale);
}

export function treeDetailFrame(stage, variant) {
  const treeFrames = DETAIL_SPRITE_FRAMES.tree;
  const stageFrame = treeFrames?.[stage] ?? treeFrames?.mature ?? null;
  if (!Array.isArray(stageFrame)) return null;
  return stageFrame[Math.abs(variant ?? 0) % stageFrame.length] ?? stageFrame[0] ?? null;
}

function detailSpriteFrame(detail) {
  const frame = DETAIL_SPRITE_FRAMES[detail.kind];
  if (detail.kind === "tree") return treeDetailFrame(detail.stage, detail.variant);
  if (frame == null || typeof frame === "number") return frame;
  const stageFrame = frame[detail.stage] ?? frame.mature ?? null;
  if (Array.isArray(stageFrame)) {
    return stageFrame[Math.abs(detail.variant ?? 0) % stageFrame.length] ?? stageFrame[0] ?? null;
  }
  return stageFrame;
}

function drawPropFrame(ctx, sprites, frameOffset, point, scale) {
  const sprite = sprites.props;
  if (!sprite?.image.complete || sprite.image.naturalWidth === 0) return false;
  if (frameOffset == null || frameOffset >= sprite.frameCount) return false;

  const sx = (sprite.startFrame + frameOffset) * sprite.cellWidth;
  const dx = Math.round(point.x - sprite.anchor.x * scale);
  const dy = Math.round(point.y - sprite.anchor.y * scale);
  const dw = Math.round(sprite.cellWidth * scale);
  const dh = Math.round(sprite.cellHeight * scale);
  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sprite.image,
    sx,
    0,
    sprite.cellWidth,
    sprite.cellHeight,
    dx,
    dy,
    dw,
    dh,
  );
  ctx.imageSmoothingEnabled = previousSmoothing;
  return true;
}
