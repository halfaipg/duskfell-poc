import { clamp } from "./terrain-noise.js";

export const VISUAL_BIOMES = [
  "meadow",
  "heath",
  "chalk",
  "frost",
  "fen",
  "moor",
  "ash",
  "blight",
];

// Designed two-region layout: a meadow heartland with a dark heath crescent
// across the northeast, split by one long organic border. The old 8-center
// softmax scattered every biome across the map in small patches; a couple of
// large readable regions is the approved map direction.
export function visualBiomeHeathField(mapX, mapY, cols, rows, seed = 7341) {
  const nx = clamp(mapX / Math.max(1, cols), 0, 1);
  const ny = clamp(mapY / Math.max(1, rows), 0, 1);
  const wander = smoothValueNoise(mapX * 0.09, mapY * 0.09, seed + 977) * 0.24;
  const detail = smoothValueNoise(mapX * 0.28, mapY * 0.28, seed + 1597) * 0.08;
  // >0 leans heath (northeast), <0 leans meadow
  return (nx - 0.62) * 1.1 + (0.42 - ny) * 1.35 + wander + detail;
}

// full heath past this distance from the border, full meadow before it
const BORDER_HALF_WIDTH = 0.16;

export function visualBiomeWeightsAt(mapX, mapY, cols, rows, seed = 7341) {
  const field = visualBiomeHeathField(mapX, mapY, cols, rows, seed);
  const heath = clamp((field + BORDER_HALF_WIDTH) / (BORDER_HALF_WIDTH * 2), 0, 1);
  const weights = Object.fromEntries(VISUAL_BIOMES.map((biome) => [biome, 0]));
  weights.heath = heath;
  weights.meadow = 1 - heath;
  return weights;
}

export function dominantVisualBiomesAt(mapX, mapY, cols, rows, seed = 7341) {
  const weights = visualBiomeWeightsAt(mapX, mapY, cols, rows, seed);
  return Object.entries(weights)
    .sort((first, second) => second[1] - first[1])
    .slice(0, 2)
    .map(([biome, weight]) => ({ biome, weight }));
}

export function activeVisualBiomesForPatch(superX, superY, patchTiles, cols, rows, seed = 7341) {
  const maxima = Object.fromEntries(VISUAL_BIOMES.map((biome) => [biome, 0]));
  for (let y = 0; y <= 4; y += 1) {
    for (let x = 0; x <= 4; x += 1) {
      const mapX = superX * patchTiles + (x / 4) * patchTiles;
      const mapY = superY * patchTiles + (y / 4) * patchTiles;
      const weights = visualBiomeWeightsAt(mapX, mapY, cols, rows, seed);
      for (const biome of VISUAL_BIOMES) {
        maxima[biome] = Math.max(maxima[biome], weights[biome]);
      }
    }
  }
  const active = VISUAL_BIOMES.filter((biome) => maxima[biome] >= 0.018).sort(
    (first, second) => maxima[second] - maxima[first],
  );
  return active.slice(0, 4);
}

function smoothValueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  const nw = hash01(x0, y0, seed);
  const ne = hash01(x0 + 1, y0, seed);
  const sw = hash01(x0, y0 + 1, seed);
  const se = hash01(x0 + 1, y0 + 1, seed);
  const north = nw * (1 - fx) + ne * fx;
  const south = sw * (1 - fx) + se * fx;
  return (north * (1 - fy) + south * fy) * 2 - 1;
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function hash01(x, y, seed) {
  let value = Math.imul(x + 101, 374761393) ^ Math.imul(y + 181, 668265263) ^ Math.imul(seed + 31, 2147483647);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}
