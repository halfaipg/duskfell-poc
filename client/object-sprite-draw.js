import { DETAIL_SPRITE_FRAMES } from "./player-config.js";
import { drawDetailShadow, treeDetailFrame } from "./terrain-detail-draw.js";

export function drawObjectSprite(ctx, sprites, cueDrawer, object, point, now = 0) {
  if (object.kind === "fieldCoil") return drawFieldCoilObject(ctx, object, point, now);
  if (drawEcologyObjectSprite(ctx, sprites, cueDrawer, object, point)) return true;

  const sprite = sprites.props;
  if (!sprite?.image.complete || sprite.image.naturalWidth === 0) return false;
  const frameOffset = objectSpriteFrame(object.kind);
  if (frameOffset == null || frameOffset >= sprite.frameCount) return false;

  return drawPropFrame(ctx, sprite, frameOffset, point, sprite.render?.scale ?? 1);
}

function drawEcologyObjectSprite(ctx, sprites, cueDrawer, object, point) {
  const sprite = sprites.details;
  if (!sprite?.image.complete || sprite.image.naturalWidth === 0) return false;
  const frame = ecologyObjectFrame(object);
  if (frame == null || frame >= sprite.frameCount) return false;

  const scale = (sprite.render?.scale ?? 1) * ecologyObjectScale(object);
  const sx = (sprite.startFrame + frame) * sprite.cellWidth;
  const dx = Math.round(point.x - sprite.anchor.x * scale);
  const dy = Math.round(point.y - sprite.anchor.y * scale);
  const dw = Math.round(sprite.cellWidth * scale);
  const dh = Math.round(sprite.cellHeight * scale);

  const shadow = sprite.render?.shadow;
  if (shadow?.kind === "ellipse") {
    drawDetailShadow(
      ctx,
      {
        x: point.x + (shadow.x - sprite.anchor.x) * scale,
        y: point.y + (shadow.y - sprite.anchor.y) * scale,
      },
      (shadow.width * scale) / 2,
      (shadow.height * scale) / 2,
      shadow.opacity,
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
  cueDrawer.drawEcologyLifecycleCues(object, point, scale);
  return true;
}

function ecologyObjectFrame(object) {
  if (object.kind === "saplingTree") {
    return treeDetailFrame(object.lifecycle?.stage ?? "sapling", ecologyVariant(object, 4));
  }
  if (object.kind === "deadwood") return 5;
  if (object.kind === "myceliumPatch") return 7;
  if (object.kind === "ruin") return DETAIL_SPRITE_FRAMES.ruin;
  return null;
}

function ecologyObjectScale(object) {
  const growth = object.lifecycle?.growth ?? 1;
  const health = object.lifecycle?.health ?? 1;
  if (object.kind === "saplingTree") {
    const stageScale =
      object.lifecycle?.stage === "ancient" ? 1.16 : object.lifecycle?.stage === "mature" ? 1.04 : 0.9;
    return stageScale + growth * 0.16 + health * 0.06;
  }
  if (object.kind === "deadwood") return 0.76 + Math.min(0.2, (object.lifecycle?.decay ?? 0) * 0.24);
  if (object.kind === "myceliumPatch") return 0.66 + growth * 0.2;
  if (object.kind === "ruin") return 1.1 + Math.min(0.18, (object.lifecycle?.decay ?? 0) * 0.2);
  return 1;
}

function ecologyVariant(object, count) {
  const speciesIndex = {
    greenwood: 0,
    shadebark: 1,
    ironleaf: 2,
    paleoak: 3,
  }[object.lifecycle?.species];
  if (speciesIndex != null) return speciesIndex % count;
  const age = object.lifecycle?.ageYears ?? 0;
  return Math.abs((stableStringHash(object.id) + age) % count);
}

function stableStringHash(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

function drawFieldCoilObject(ctx, object, point, now) {
  const fullness = object.resources?.[0]?.maxAmount
    ? Math.max(0, Math.min(1, object.resources[0].amount / object.resources[0].maxAmount))
    : 0.55;
  const health = object.lifecycle?.health ?? fullness;
  const flicker = Math.sin(now * 0.018 + object.x * 0.01) * 0.5 + 0.5;

  ctx.save();
  drawDetailShadow(ctx, point, 25, 8, 0.28);

  ctx.fillStyle = "#4a3a2e";
  ctx.fillRect(point.x - 18, point.y - 10, 36, 16);
  ctx.fillStyle = "#8b5b34";
  ctx.fillRect(point.x - 14, point.y - 16, 28, 8);
  ctx.strokeStyle = "#211c18";
  ctx.lineWidth = 2;
  ctx.strokeRect(point.x - 18.5, point.y - 10.5, 37, 17);

  ctx.strokeStyle = "#343b3c";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y - 12);
  ctx.lineTo(point.x, point.y - 54);
  ctx.stroke();

  ctx.strokeStyle = "#b46b36";
  ctx.lineWidth = 2;
  for (let ring = 0; ring < 6; ring += 1) {
    const y = point.y - 18 - ring * 5;
    ctx.beginPath();
    ctx.ellipse(point.x, y, 10, 3.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = `rgba(142, 231, 238, ${0.18 + health * 0.5})`;
  ctx.lineWidth = 1.5;
  for (let arc = 0; arc < 3; arc += 1) {
    const side = arc % 2 === 0 ? -1 : 1;
    const height = point.y - 51 + arc * 9;
    ctx.beginPath();
    ctx.moveTo(point.x + side * 6, height);
    ctx.lineTo(point.x + side * (15 + flicker * 5), height - 6);
    ctx.lineTo(point.x + side * (8 + arc * 3), height - 10);
    ctx.stroke();
  }

  ctx.fillStyle = `rgba(229, 247, 221, ${0.22 + health * 0.58})`;
  ctx.beginPath();
  ctx.arc(point.x, point.y - 56, 3 + flicker * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return true;
}

function drawPropFrame(ctx, sprite, frameOffset, point, scale) {
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

function objectSpriteFrame(kind) {
  switch (kind) {
    case "registrar":
      return 0;
    case "forge":
      return 1;
    case "grove":
      return 2;
    case "ore":
      return 3;
    case "shrine":
      return 4;
    default:
      return null;
  }
}
