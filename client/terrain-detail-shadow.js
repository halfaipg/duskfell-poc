export function drawDetailShadow(ctx, point, width, height, opacity) {
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + height * 0.7, width, height, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(12, 15, 13, ${opacity})`;
  ctx.fill();
}
