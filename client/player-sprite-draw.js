import { PLAYER_TURN_FADE_MS, walkAnimationSample } from "./player-animation.js";
import { PLAYER_RENDER_SCALE } from "./player-config.js";
import { stableIndex } from "./player-draw-utils.js";

export function drawPlayerSprite(ctx, player, point, motion, now, sprite = null, grounding = null) {
  if (sprite?.kind === "paperdoll") {
    return drawPlayerPaperdollSprite(ctx, player, point, motion, now, sprite, grounding);
  }
  if (!sprite?.image.complete || sprite.image.naturalWidth === 0) return false;

  const frame = playerSpriteFrame(player, point, motion, now, sprite, grounding);
  if (!frame) return false;

  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  // fluid turn: briefly crossfade from the previous facing so a direction
  // change reads as the body coming around instead of a hard sprite swap
  const fade = turnFadeFor(motion, now);
  if (fade) {
    const prev = playerSpriteFrame(player, point, motion, now, sprite, grounding, fade.previousDirection);
    if (prev) {
      const previousAlpha = ctx.globalAlpha;
      ctx.globalAlpha = previousAlpha * (1 - fade.t);
      ctx.drawImage(sprite.image, prev.sx, prev.sy, sprite.cellWidth, sprite.cellHeight, prev.dx, prev.dy, prev.dw, prev.dh);
      ctx.globalAlpha = previousAlpha;
    }
  }
  ctx.drawImage(sprite.image, frame.sx, frame.sy, sprite.cellWidth, sprite.cellHeight, frame.dx, frame.dy, frame.dw, frame.dh);
  ctx.imageSmoothingEnabled = previousSmoothing;
  return true;
}

function turnFadeFor(motion, now) {
  if (!motion.previousDirection || !Number.isFinite(motion.directionChangedMs)) return null;
  const elapsed = now - motion.directionChangedMs;
  if (elapsed < 0 || elapsed >= PLAYER_TURN_FADE_MS) return null;
  return { previousDirection: motion.previousDirection, t: elapsed / PLAYER_TURN_FADE_MS };
}

export function drawPlayerShadow(ctx, point, isMe, sprite, grounding = null) {
  const shadow = sprite?.render?.shadow;
  if (shadow?.kind === "none") return;
  if (shadow?.kind === "ellipse") {
    const anchor = sprite.anchor;
    const scale = sprite.render?.scale ?? PLAYER_RENDER_SCALE;
    ctx.beginPath();
    ctx.ellipse(
      point.x + (shadow.x - anchor.x) * scale + (grounding?.shadowOffsetX ?? 0),
      point.y + (shadow.y - anchor.y) * scale + (grounding?.shadowOffsetY ?? 0),
      ((shadow.width * scale) / 2) * (grounding?.shadowScaleX ?? 1),
      ((shadow.height * scale) / 2) * (grounding?.shadowScaleY ?? 1),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = isMe
      ? `rgba(239, 217, 139, ${Math.min(0.42, shadow.opacity + 0.1)})`
      : `rgba(17, 20, 23, ${shadow.opacity})`;
    ctx.fill();
    if (isMe) {
      ctx.strokeStyle = "rgba(255, 245, 188, 0.58)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    return;
  }

  ctx.beginPath();
  ctx.ellipse(
    point.x + (grounding?.shadowOffsetX ?? 0),
    point.y - 2 + (grounding?.shadowOffsetY ?? 0),
    (isMe ? 27 : 23) * (grounding?.shadowScaleX ?? 1),
    (isMe ? 12 : 10) * (grounding?.shadowScaleY ?? 1),
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = isMe ? "rgba(239, 217, 139, 0.3)" : "rgba(17, 20, 23, 0.22)";
  ctx.fill();
  if (isMe) {
    ctx.strokeStyle = "rgba(255, 245, 188, 0.58)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
}

function drawPlayerPaperdollSprite(ctx, player, point, motion, now, sprite, grounding = null) {
  if (!Array.isArray(sprite.layers) || sprite.layers.length === 0) return false;
  if (sprite.layers.some((layer) => !layer.image?.complete || layer.image.naturalWidth === 0)) {
    return false;
  }

  const frame = playerSpriteFrame(player, point, motion, now, sprite, grounding);
  if (!frame) return false;

  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  for (const layer of sprite.layers) {
    ctx.drawImage(
      layer.image,
      frame.sx,
      frame.sy,
      sprite.cellWidth,
      sprite.cellHeight,
      frame.dx,
      frame.dy,
      frame.dw,
      frame.dh,
    );
  }
  ctx.imageSmoothingEnabled = previousSmoothing;
  return true;
}

function playerSpriteFrame(player, point, motion, now, sprite, grounding = null, directionName = null) {
  const direction =
    sprite.directions?.[directionName ?? motion.direction] ?? sprite.directions?.south;
  if (!direction) return null;
  const elapsed = Math.max(0, now - motion.walkStartMs);
  const animation = walkAnimationSample({
    moving: motion.moving,
    elapsedMs: elapsed,
    frameCount: direction.frameCount,
    stablePhase: stableIndex(player.id) * 0.15,
    speedRatio: motion.speedRatio || 1,
    idleFrame: sprite.animation?.idleFrame ?? 0,
    frameSequence: sprite.animation?.walkFrames ?? null,
    idleElapsedMs:
      motion.lastMovementMs != null ? now - motion.lastMovementMs : now - motion.walkStartMs,
    fidgetFrames: sprite.animation?.fidgetFrames ?? null,
    idleFrames: sprite.animation?.idleFrames ?? null,
  });
  const sourceFrame = direction.startFrame + animation.frameIndex;
  const sx = (sourceFrame % sprite.columns) * sprite.cellWidth;
  const sy = Math.floor(sourceFrame / sprite.columns) * sprite.cellHeight;
  const scale = sprite.render?.scale ?? PLAYER_RENDER_SCALE;
  const dx = Math.round(point.x - sprite.anchor.x * scale + animation.bodyOffsetX);
  const dy = Math.round(
    point.y - sprite.anchor.y * scale + animation.bodyOffsetY + (grounding?.bodyOffsetY ?? 0),
  );
  const dw = Math.round(sprite.cellWidth * scale);
  const dh = Math.round(sprite.cellHeight * scale);

  return { sx, sy, dx, dy, dw, dh };
}
