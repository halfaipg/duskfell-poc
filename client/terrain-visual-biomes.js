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

const BIOME_CENTERS = {
  meadow: { x: 0.5, y: 0.5, bias: 0.16 },
  heath: { x: 0.18, y: 0.24, bias: 0 },
  chalk: { x: 0.8, y: 0.2, bias: 0 },
  frost: { x: 0.5, y: -0.04, bias: 0.03 },
  fen: { x: 0.12, y: 0.76, bias: 0.02 },
  moor: { x: 0.46, y: 0.92, bias: 0 },
  ash: { x: 0.91, y: 0.56, bias: 0 },
  blight: { x: 0.82, y: 0.92, bias: -0.02 },
};

const SCORE_SHARPNESS = 5.4;
const ORGANIC_WANDER = 0.22;

export function visualBiomeWeightsAt(mapX, mapY, cols, rows, seed = 7341) {
  const nx = clamp(mapX / Math.max(1, cols), 0, 1);
  const ny = clamp(mapY / Math.max(1, rows), 0, 1);
  const scores = VISUAL_BIOMES.map((biome, index) => {
    const center = BIOME_CENTERS[biome];
    const dx = nx - center.x;
    const dy = ny - center.y;
    const distanceScore = -(dx * dx + dy * dy) * 5.8;
    const wander = smoothValueNoise(mapX * 0.14, mapY * 0.14, seed + index * 977);
    const detail = smoothValueNoise(mapX * 0.32, mapY * 0.32, seed + index * 1597) * 0.36;
    const centerShelter = biome === "meadow" ? Math.max(0, 0.24 - Math.hypot(dx, dy)) * 1.8 : 0;
    return distanceScore + wander * ORGANIC_WANDER + detail * ORGANIC_WANDER + center.bias + centerShelter;
  });
  const maxScore = Math.max(...scores);
  const exponentials = scores.map((score) => Math.exp((score - maxScore) * SCORE_SHARPNESS));
  const total = exponentials.reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(VISUAL_BIOMES.map((biome, index) => [biome, exponentials[index] / total]));
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
