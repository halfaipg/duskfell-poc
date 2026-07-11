import { PROJECTION, projectWorld } from "./projection.js";
import { streamCenterAt } from "./terrain-biome.js";

// Ambient fish: dark shapes cruising the stream under the surface, with the
// occasional ripple ring. Pure client ambience — when fishing gameplay lands
// server-side these become the visual layer over real fish stock.
const FISH_COUNT = 5;
const FISH_ALPHA = 0.38;

export function drawWaterFish(ctx, terrain, origin, camera, viewport, now) {
  if (!terrain || !origin) return;
  const units = PROJECTION.unitsPerTile;
  const seconds = now / 1000;
  const viewMinX = camera.x - 80;
  const viewMaxX = camera.x + viewport.width / camera.scale + 80;
  const viewMinY = camera.y - 80;
  const viewMaxY = camera.y + viewport.height / camera.scale + 80;

  ctx.save();
  for (let index = 0; index < FISH_COUNT; index += 1) {
    const speed = 0.5 + (index % 5) * 0.12;   // tiles/second downstream
    const phase = (index * 9.37) % terrain.rows;
    const span = terrain.rows - 6;
    const yTile = ((seconds * speed + phase) % span) + 3;
    const sway = Math.sin(seconds * 0.9 + index * 2.13) * 0.42;
    const center = streamCenterAt(yTile, terrain.cols, terrain.rows, terrain.profile);
    const point = projectWorld((center + sway) * units, yTile * units, -1, origin);
    if (point.x < viewMinX || point.x > viewMaxX || point.y < viewMinY || point.y > viewMaxY) {
      continue;
    }
    const aheadCenter = streamCenterAt(yTile + 0.4, terrain.cols, terrain.rows, terrain.profile);
    const ahead = projectWorld((aheadCenter + sway * 0.92) * units, (yTile + 0.4) * units, -1, origin);
    const angle = Math.atan2(ahead.y - point.y, ahead.x - point.x);
    const wiggle = Math.sin(seconds * 7 + index * 3.7) * 0.35;

    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(angle);
    ctx.globalAlpha = FISH_ALPHA;
    ctx.fillStyle = "#141f1a";
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(-11, -2.6 + wiggle);
    ctx.lineTo(-11, 2.6 + wiggle);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // ripple ring when a fish grazes the surface (~every 7s per fish)
    const rippleCycle = (seconds + index * 1.7) % 7;
    if (rippleCycle < 1.1) {
      const growth = rippleCycle / 1.1;
      ctx.save();
      ctx.globalAlpha = (1 - growth) * 0.3;
      ctx.strokeStyle = "#cfe0d4";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(point.x, point.y, 4 + growth * 14, (4 + growth * 14) * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}
