import { PROJECTION, projectWorld } from "./projection.js";

// Ambient fish: dark shapes cruising the water, steered by the channel flow
// field from WorldData — no formula dependency, works in any world. Each
// fish integrates along the flow with a little wander, and respawns on a
// random water tile when it strays out of the channel.
const FISH_COUNT = 5;
const FISH_ALPHA = 0.38;
const FISH_SPEED_TILES = 0.55;

const fishStates = new Map(); // index -> {x, y (tile coords), phase}
let fishWorld = null;

export function drawWaterFish(ctx, terrain, origin, camera, viewport, now) {
  if (!terrain?.worldData || !origin) return;
  const { channel } = terrain.worldData;
  const waterTiles = channel.waterTiles;
  if (!waterTiles?.length) return;
  if (fishWorld !== terrain.worldData) {
    fishWorld = terrain.worldData;
    fishStates.clear();
  }
  const units = PROJECTION.unitsPerTile;
  const seconds = now / 1000;
  const viewMinX = camera.x - 80;
  const viewMaxX = camera.x + viewport.width / camera.scale + 80;
  const viewMinY = camera.y - 80;
  const viewMaxY = camera.y + viewport.height / camera.scale + 80;

  ctx.save();
  for (let index = 0; index < FISH_COUNT; index += 1) {
    let fish = fishStates.get(index);
    if (!fish || channel.distanceAt(fish.x, fish.y) > 0.9) {
      const spawn = waterTiles[(index * 37 + Math.floor(seconds / 9)) % waterTiles.length];
      fish = { x: spawn.x + 0.5, y: spawn.y + 0.5, phase: index * 2.13, lastMs: now };
      fishStates.set(index, fish);
    }
    const dt = Math.min(0.1, Math.max(0, (now - fish.lastMs) / 1000));
    fish.lastMs = now;
    const flow = channel.flowAt(fish.x, fish.y);
    const wander = Math.sin(seconds * 0.8 + fish.phase) * 0.5;
    const speed = FISH_SPEED_TILES * (0.7 + (index % 3) * 0.2);
    fish.x += (flow.x - flow.y * wander * 0.4) * speed * dt;
    fish.y += (flow.y + flow.x * wander * 0.4) * speed * dt;

    const point = projectWorld(fish.x * units, fish.y * units, -1, origin);
    if (point.x < viewMinX || point.x > viewMaxX || point.y < viewMinY || point.y > viewMaxY) {
      continue;
    }
    const ahead = projectWorld(
      (fish.x + flow.x * 0.4) * units,
      (fish.y + flow.y * 0.4) * units,
      -1,
      origin,
    );
    const angle = Math.atan2(ahead.y - point.y, ahead.x - point.x);
    const wiggle = Math.sin(seconds * 7 + fish.phase * 3.7) * 0.35;

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
