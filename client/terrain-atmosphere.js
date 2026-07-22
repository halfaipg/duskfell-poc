import { GRAPHICS_BUDGET } from "./device-profile.js";
import { projectMap } from "./projection.js";

const atmosphereCache = new WeakMap();

export function atmospherePatchesForTerrain(terrain, { blockTiles = 12 } = {}) {
  if (!terrain || !Number.isInteger(blockTiles) || blockTiles < 1) return [];
  const cached = atmosphereCache.get(terrain);
  if (cached?.blockTiles === blockTiles) return cached.patches;

  const tiles = Array.isArray(terrain.loadedTiles)
    ? terrain.loadedTiles
    : Array.isArray(terrain.tiles)
      ? terrain.tiles.filter(Boolean)
      : [];
  const blocks = new Map();

  for (const tile of tiles) {
    const climate = atmosphereClimateForTile(tile);
    if (climate.fogPotential < 0.25) continue;
    const blockX = Math.floor(tile.x / blockTiles);
    const blockY = Math.floor(tile.y / blockTiles);
    const seed = hash2(tile.x, tile.y);
    const score = climate.fogPotential * (0.82 + seed * 0.18);
    const key = `${blockX}:${blockY}`;
    if ((blocks.get(key)?.score ?? -1) < score) {
      blocks.set(key, { tile, climate, score, seed });
    }
  }

  const patches = [...blocks.values()]
    .map((candidate) => atmospherePatch(candidate))
    .sort((left, right) => left.mapY - right.mapY || left.mapX - right.mapX);
  atmosphereCache.set(terrain, { blockTiles, patches });
  return patches;
}

export function atmosphereClimateForTile(tile) {
  const biome = tile?.biome ?? {};
  const moisture = bounded(biome.moisture, 0.4);
  const humidity = bounded(biome.humidity, moisture * 0.88 + bounded(biome.waterPressure) * 0.2);
  const windExposure = bounded(
    biome.windExposure,
    bounded(biome.elevation) * 0.35 + bounded(biome.rockiness) * 0.22,
  );
  const lowland = 1 - bounded(biome.elevation);
  const water = bounded(biome.waterPressure);
  const fogPotential = bounded(
    biome.fogPotential,
    Math.max(0, (humidity - 0.48) * 1.55 + water * 0.3 + lowland * 0.12 - windExposure * 0.28),
  );
  return {
    fogPotential,
    humidity,
    temperature: bounded(biome.temperature, 0.5),
    windExposure,
  };
}

export function atmosphereOpacity(patch, sunElevation = 0.7) {
  const daylight = bounded(Math.max(0, sunElevation));
  const horizon = Math.max(0, 1 - Math.abs(sunElevation) * 5);
  const dispersal = 0.56 + (1 - daylight) * 0.24 + horizon * 0.2;
  return Math.min(0.16, patch.alpha * dispersal);
}

export function drawTerrainAtmosphere(
  ctx,
  terrain,
  origin,
  camera,
  viewport,
  now,
  sun,
  budget = GRAPHICS_BUDGET,
) {
  if (
    !ctx
    || !terrain
    || !origin
    || !camera
    || !viewport
    || (budget.maxAtmospherePatches ?? 0) <= 0
  ) return 0;
  const patches = atmospherePatchesForTerrain(terrain);
  const margin = 220;
  const bounds = {
    minX: camera.x - margin,
    maxX: camera.x + viewport.width / camera.scale + margin,
    minY: camera.y - margin,
    maxY: camera.y + viewport.height / camera.scale + margin,
  };
  const moving = budget.atmosphereMotion === "drift";
  const visible = patches
    .map((patch) => projectedAtmospherePatch(patch, origin, moving ? now : 0))
    .filter((patch) =>
      patch.center.x >= bounds.minX
      && patch.center.x <= bounds.maxX
      && patch.center.y >= bounds.minY
      && patch.center.y <= bounds.maxY,
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, budget.maxAtmospherePatches ?? 0)
    .sort((left, right) => left.center.y - right.center.y);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = budget.atmosphereBlurPx > 0 ? `blur(${budget.atmosphereBlurPx}px)` : "none";
  for (const patch of visible) {
    drawFogRibbon(ctx, patch, atmosphereOpacity(patch, sun?.elevation));
  }
  ctx.restore();
  return visible.length;
}

function atmospherePatch({ tile, climate, score, seed }) {
  const slopeX = Number.isFinite(tile.height?.slopeX) ? tile.height.slopeX : 0;
  const slopeY = Number.isFinite(tile.height?.slopeY) ? tile.height.slopeY : 0;
  const slopeLength = Math.hypot(slopeX, slopeY);
  const regionalWind = { x: 0.94, y: -0.34 };
  let contourX = slopeLength > 0.18 ? -slopeY / slopeLength : regionalWind.x;
  let contourY = slopeLength > 0.18 ? slopeX / slopeLength : regionalWind.y;
  if (contourX * regionalWind.x + contourY * regionalWind.y < 0) {
    contourX *= -1;
    contourY *= -1;
  }
  const tangentLength = Math.hypot(
    regionalWind.x * 0.68 + contourX * 0.32,
    regionalWind.y * 0.68 + contourY * 0.32,
  ) || 1;
  const tangentX = (regionalWind.x * 0.68 + contourX * 0.32) / tangentLength;
  const tangentY = (regionalWind.y * 0.68 + contourY * 0.32) / tangentLength;
  const jitterX = hash2(tile.x + 19, tile.y - 7) - 0.5;
  const jitterY = hash2(tile.x - 11, tile.y + 23) - 0.5;
  const minHeight = Number.isFinite(tile.height?.min) ? tile.height.min : tile.height?.average ?? 0;
  const cold = 1 - climate.temperature;

  return {
    mapX: tile.x + 0.5 + jitterX * 0.8,
    mapY: tile.y + 0.5 + jitterY * 0.8,
    mapZ: minHeight + 0.18 + climate.fogPotential * 0.08,
    tangentX,
    tangentY,
    lengthTiles: 4.2 + climate.fogPotential * 5.4 + climate.humidity * 0.8,
    thickness: 16 + climate.fogPotential * 25,
    alpha: 0.022 + climate.fogPotential * 0.074,
    color: [
      Math.round(194 + cold * 14),
      Math.round(202 + cold * 12),
      Math.round(194 + cold * 22),
    ],
    phase: seed * Math.PI * 2,
    score,
    windExposure: climate.windExposure,
  };
}

function projectedAtmospherePatch(patch, origin, now) {
  const drift = now > 0
    ? Math.sin(now * 0.00009 + patch.phase) * (0.08 + patch.windExposure * 0.24)
    : 0;
  const mapX = patch.mapX + patch.tangentX * drift;
  const mapY = patch.mapY + patch.tangentY * drift;
  const halfLength = patch.lengthTiles / 2;
  const start = projectMap(
    mapX - patch.tangentX * halfLength,
    mapY - patch.tangentY * halfLength,
    patch.mapZ,
    origin,
  );
  const end = projectMap(
    mapX + patch.tangentX * halfLength,
    mapY + patch.tangentY * halfLength,
    patch.mapZ,
    origin,
  );
  return {
    ...patch,
    center: projectMap(mapX, mapY, patch.mapZ, origin),
    start,
    end,
  };
}

function drawFogRibbon(ctx, patch, opacity) {
  if (opacity <= 0) return;
  const dx = patch.end.x - patch.start.x;
  const dy = patch.end.y - patch.start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const thickness = patch.thickness;
  const control = length * 0.32;

  ctx.beginPath();
  ctx.moveTo(patch.start.x + nx * thickness * 0.18, patch.start.y + ny * thickness * 0.18);
  ctx.bezierCurveTo(
    patch.start.x + dx * 0.25 + nx * thickness,
    patch.start.y + dy * 0.25 + ny * thickness,
    patch.end.x - dx * 0.25 + nx * thickness * 0.72,
    patch.end.y - dy * 0.25 + ny * thickness * 0.72,
    patch.end.x + nx * thickness * 0.12,
    patch.end.y + ny * thickness * 0.12,
  );
  ctx.bezierCurveTo(
    patch.end.x - dx * 0.2 - nx * thickness * 0.74,
    patch.end.y - dy * 0.2 - ny * thickness * 0.74,
    patch.start.x + dx * 0.2 - nx * thickness * 0.58,
    patch.start.y + dy * 0.2 - ny * thickness * 0.58,
    patch.start.x + nx * thickness * 0.18,
    patch.start.y + ny * thickness * 0.18,
  );
  ctx.closePath();

  const [red, green, blue] = patch.color;
  const gradient = ctx.createLinearGradient(
    patch.start.x - (dx / length) * control,
    patch.start.y - (dy / length) * control,
    patch.end.x + (dx / length) * control,
    patch.end.y + (dy / length) * control,
  );
  gradient.addColorStop(0, `rgba(${red}, ${green}, ${blue}, 0)`);
  gradient.addColorStop(0.18, `rgba(${red}, ${green}, ${blue}, ${opacity * 0.6})`);
  gradient.addColorStop(0.5, `rgba(${red}, ${green}, ${blue}, ${opacity})`);
  gradient.addColorStop(0.82, `rgba(${red}, ${green}, ${blue}, ${opacity * 0.58})`);
  gradient.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fill();
}

function bounded(value, fallback = 0) {
  const number = Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, number));
}

function hash2(x, y) {
  let value = Math.imul(x | 0, 0x45d9f3b) ^ Math.imul(y | 0, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}
