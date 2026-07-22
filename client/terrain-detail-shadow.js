import { shadowCast } from "./sun-state.js";

export function drawDetailShadow(ctx, point, width, height, opacity) {
  const cast = shadowCast();
  const objectHeight = Math.max(width * 0.85, height * 2);
  if (cast.alpha > 0.01 && cast.length > 0.01) {
    const distance = objectHeight * cast.length * 0.42;
    const rotation = Math.atan2(cast.dirY, cast.dirX);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(
      point.x + cast.dirX * distance,
      point.y + cast.dirY * distance * 0.55,
      width * (0.5 + cast.length * 0.28),
      Math.max(1.5, height * (0.48 + cast.length * 0.1)),
      rotation,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = `rgba(12, 15, 13, ${Math.min(opacity, cast.alpha * 0.82)})`;
    ctx.fill();
    ctx.restore();
  }

  // Small ambient-occlusion patch remains at the anchor at noon and night.
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + height * 0.7, width, height, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(12, 15, 13, ${opacity * 0.48})`;
  ctx.fill();
}
