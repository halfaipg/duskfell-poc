import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildTerrainDetailAuthorityPatch, composeWorldEcology, renderEcologyReview } from "../worldgen/ecology-composition.mjs";
import { deriveClimateAuthority } from "../worldgen/climate-authority.mjs";
import { writeWorldChunks } from "../worldgen/chunk-package.mjs";
import { writeChunkVisualControls } from "../worldgen/chunk-visuals.mjs";
import { buildHydrologyAuthority, calculatePriorityFlood, extractTributaries } from "../worldgen/hydrology-authority.mjs";
import { erodeHeightfield } from "../worldgen/erosion-authority.mjs";
import { buildWaterAuthority } from "../worldgen/water-authority.mjs";
import { attachMaterialWeights } from "../worldgen/material-weights.mjs";
import { applyAuthoredFeatures, planWorldFeatures } from "../worldgen/world-planning.mjs";
import {
  applyRiverRoutePoint,
  applyTerrainBrushPoint,
  validateTerrainOperations,
} from "../../client/world-editor-terrain-authoring.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_RECIPE = path.join(ROOT, "worlds/recipes/duskfell-valley.json");
const BIOMES = ["meadow", "loam", "rock", "snow", "wetland", "water"];

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smoothstep = (a, b, value) => {
  const t = clamp((value - a) / Math.max(1e-9, b - a));
  return t * t * (3 - 2 * t);
};
const round = (value, digits = 4) => Number(value.toFixed(digits));
const grid = (rows, cols, fn) => Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => fn(x, y)));

function hash01(x, y, seed) {
  let value = Math.imul(x + 0x9e3779b9, 374761393) ^ Math.imul(y + seed, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash01(x0, y0, seed);
  const b = hash01(x0 + 1, y0, seed);
  const c = hash01(x0, y0 + 1, seed);
  const d = hash01(x0 + 1, y0 + 1, seed);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

function fbm(x, y, seed) {
  let sum = 0;
  let amplitude = 0.55;
  let frequency = 0.08;
  for (let octave = 0; octave < 5; octave += 1) {
    sum += amplitude * valueNoise(x * frequency, y * frequency, seed + octave * 1013);
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / 1.066;
}

function riverCenter(y, recipe) {
  const base = recipe.terrain.valleyCenterX;
  return base + Math.sin(y * 0.14 + 0.8) * 4.2 + Math.sin(y * 0.047 + 2.1) * 2.0;
}

function lakeDistance(x, y, lake) {
  return Math.hypot((x - lake.x) / lake.radiusX, (y - lake.y) / lake.radiusY);
}

function tributaryPressure(x, y, tributaries, riverWidth) {
  let pressure = 0;
  for (const tributary of tributaries) {
    const width = riverWidth * (0.16 + tributary.order * 0.055);
    let distance = Infinity;
    for (let index = 0; index < tributary.points.length - 1; index += 1) {
      distance = Math.min(distance, pointSegmentDistance(x, y, tributary.points[index], tributary.points[index + 1]));
    }
    pressure = Math.max(pressure, 1 - smoothstep(width * 0.72, width * 1.32, distance));
  }
  return pressure;
}

function pointSegmentDistance(x, y, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? clamp(((x - from.x) * dx + (y - from.y) * dy) / lengthSquared) : 0;
  return Math.hypot(x - (from.x + dx * t), y - (from.y + dy * t));
}

function vertexElevation(x, y, recipe) {
  const { cols, rows } = recipe.dimensions;
  const center = riverCenter(y, recipe);
  const distance = Math.abs(x - center) / recipe.terrain.valleyHalfWidth;
  const mountain = smoothstep(0.34, 1.15, distance);
  const ridge = Math.pow(mountain, 1.34) * 0.68;
  const northRise = smoothstep(0.38, 1, 1 - y / rows) * 0.12;
  const broad = (fbm(x, y, recipe.seed) - 0.5) * (0.08 + mountain * 0.16);
  const crags = (fbm(x * 2.1 + 91, y * 2.1 - 47, recipe.seed + 71) - 0.5) * mountain * 0.17;
  let elevation = 0.12 + ridge + northRise + broad + crags;

  const channelDistance = Math.abs(x - center);
  const channel = Math.exp(-(channelDistance * channelDistance) / 4.5);
  elevation -= channel * (0.04 + (1 - mountain) * 0.055);

  const lakeD = lakeDistance(x, y, recipe.terrain.lake);
  if (lakeD < 1.25) {
    const lakeBed = 0.092 + Math.max(0, lakeD - 0.85) * 0.025;
    elevation = Math.min(elevation, lakeBed);
  }
  return clamp(elevation, 0, 1);
}

function waterAt(x, y, recipe, riverCenterline) {
  const lakeD = lakeDistance(x, y, recipe.terrain.lake);
  if (lakeD <= 1) return { water: 1, lake: 1, river: 0 };
  const position = clamp(y - 0.5, 0, riverCenterline.length - 1);
  const row = Math.floor(position);
  const next = Math.min(riverCenterline.length - 1, row + 1);
  const blend = position - row;
  const center = riverCenterline[row].x * (1 - blend) + riverCenterline[next].x * blend;
  const width = recipe.terrain.riverWidth * (0.82 + 0.25 * smoothstep(0, recipe.dimensions.rows, y));
  const river = 1 - smoothstep(width * 0.72, width * 1.4, Math.abs(x - center));
  return { water: river, lake: 0, river };
}

function normalizeWeights(weights) {
  const total = Object.values(weights).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, round(Math.max(0, value) / total)]));
}

function slopeAt(x, y, heights) {
  const rows = heights.length - 1;
  const cols = heights[0].length - 1;
  const x0 = Math.max(0, x);
  const x1 = Math.min(cols, x + 1);
  const y0 = Math.max(0, y);
  const y1 = Math.min(rows, y + 1);
  const dx = ((heights[y0][x1] + heights[y1][x1]) - (heights[y0][x0] + heights[y1][x0])) * 0.5;
  const dy = ((heights[y1][x0] + heights[y1][x1]) - (heights[y0][x0] + heights[y0][x1])) * 0.5;
  return clamp(Math.hypot(dx, dy) * 6.5);
}

function dominantMaterial(weights) {
  const key = BIOMES.reduce((winner, biome) => weights[biome] > weights[winner] ? biome : winner, BIOMES[0]);
  if (key === "meadow" || key === "wetland") return "grass";
  if (key === "loam") return "dirt";
  if (key === "snow") return "rock";
  return key;
}

export function generateWorld(recipe, options = {}) {
  const { cols, rows, unitsPerTile } = recipe.dimensions;
  const terrainOperations = options.terrainOperations ?? [];
  validateTerrainOperations(terrainOperations, recipe.dimensions);
  let heights = grid(rows + 1, cols + 1, (x, y) => round(vertexElevation(x, y, recipe), 5));
  for (const operation of terrainOperations.filter((item) => item.field === "elevation")) {
    for (const point of operation.points) applyTerrainBrushPoint(heights, point, operation);
  }
  const preErosionHeights = heights.map((row) => [...row]);
  const erosion = erodeHeightfield(Float64Array.from(heights.flat()), cols + 1, rows + 1, {
    ...recipe.erosion,
    seed: recipe.seed,
  });
  heights = matrix(erosion.elevation, cols + 1, rows + 1, (value) => value);
  const riverCenterline = grid(rows, 1, (_, y) => ({ x: round(riverCenter(y + 0.5, recipe), 3), y: y + 0.5 })).flat();
  for (const operation of terrainOperations.filter((item) => item.field === "riverSpline")) {
    for (const point of operation.points) applyRiverRoutePoint(riverCenterline, point, cols);
  }
  const fields = Object.fromEntries(["temperature", "moisture", "rockiness", "snow", "soil", "disturbance", "vegetation", "water", "river", "lake", "slope"].map((name) => [name, grid(rows, cols, () => 0)]));
  const biomeWeights = Object.fromEntries(BIOMES.map((name) => [name, grid(rows, cols, () => 0)]));
  const materialRows = [];

  for (let y = 0; y < rows; y += 1) {
    let materialRow = "";
    for (let x = 0; x < cols; x += 1) {
      const elevation = (heights[y][x] + heights[y][x + 1] + heights[y + 1][x] + heights[y + 1][x + 1]) * 0.25;
      const slope = slopeAt(x, y, heights);
      const water = waterAt(x + 0.5, y + 0.5, recipe, riverCenterline);
      const temperature = clamp(0.94 - elevation * 0.92 - (y / rows) * 0.08);
      const moisture = clamp(0.39 + (1 - Math.min(1, Math.abs(x + 0.5 - riverCenter(y + 0.5, recipe)) / 13)) * 0.36 + (fbm(x + 311, y - 91, recipe.seed + 9) - 0.5) * 0.25);
      const rockiness = clamp(slope * 0.75 + smoothstep(0.48, 0.87, elevation) * 0.74);
      const snow = clamp(smoothstep(recipe.terrain.snowline - 0.035, recipe.terrain.snowline + 0.035, elevation) * (1 - smoothstep(0.05, 0.42, temperature)));
      const soil = clamp(0.88 - rockiness * 0.78 + moisture * 0.14);
      const wetland = clamp((1 - water.water) * smoothstep(0.62, 0.88, moisture) * smoothstep(0.28, 0.08, elevation));
      const meadow = clamp((1 - rockiness) * soil * (0.52 + moisture * 0.48) * (1 - wetland * 0.65));
      const loam = clamp((1 - rockiness * 0.7) * (0.9 - moisture * 0.48) * (0.74 + slope * 0.2));
      const weights = normalizeWeights({
        meadow: meadow * (1 - water.water),
        loam: loam * (1 - water.water),
        rock: rockiness * (1 - snow) * (1 - water.water),
        snow: snow * (1 - water.water),
        wetland: wetland * (1 - water.water),
        water: water.water,
      });
      const values = { temperature, moisture, rockiness, snow, soil, disturbance: 0, vegetation: clamp(meadow * 0.8 + wetland * 0.68), water: water.water, river: water.river, lake: water.lake, slope };
      for (const [name, value] of Object.entries(values)) fields[name][y][x] = round(value);
      for (const biome of BIOMES) biomeWeights[biome][y][x] = weights[biome];
      const material = dominantMaterial(weights);
      const legend = ["grass", "field", "dirt", "stone", "water", "settlement", "cobble", "rock", "ruin", "shore"];
      materialRow += legend.indexOf(material).toString(36);
    }
    materialRows.push(materialRow);
  }
  for (const operation of terrainOperations.filter((item) => item.field === "moisture" || item.field === "rockiness")) {
    for (const point of operation.points) applyTerrainBrushPoint(fields[operation.field], point, operation);
  }

  const tileElevation = Float64Array.from({ length: cols * rows }, (_, index) => {
    const x = index % cols;
    const y = Math.floor(index / cols);
    return (heights[y][x] + heights[y][x + 1] + heights[y + 1][x] + heights[y + 1][x + 1]) * 0.25;
  });
  const hydrology = calculatePriorityFlood(tileElevation, cols, rows);
  const tributaries = extractTributaries({
    directions: hydrology.directions,
    accumulation: hydrology.accumulation,
    width: cols,
    height: rows,
    riverCenterline,
    maxTributaries: recipe.hydrology.maxTributaries,
    minimumTiles: recipe.hydrology.minTributaryLengthTiles,
  });
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    const tributary = tributaryPressure(x + 0.5, y + 0.5, tributaries, recipe.terrain.riverWidth);
    if (tributary <= fields.river[y][x]) continue;
    const water = Math.max(fields.lake[y][x], tributary);
    fields.river[y][x] = round(tributary);
    fields.water[y][x] = round(water);
    const snow = round(fields.snow[y][x] * (1 - water));
    fields.snow[y][x] = snow;
    fields.moisture[y][x] = round(clamp(fields.moisture[y][x] * 0.82 + water * 0.18));
    const terrestrial = ["meadow", "loam", "rock", "wetland"];
    const terrestrialTotal = terrestrial.reduce((sum, biome) => sum + biomeWeights[biome][y][x], 0) || 1;
    const terrestrialBudget = Math.max(0, 1 - water - snow);
    for (const biome of terrestrial) biomeWeights[biome][y][x] = round(biomeWeights[biome][y][x] / terrestrialTotal * terrestrialBudget);
    biomeWeights.water[y][x] = round(water);
    biomeWeights.snow[y][x] = snow;
  }
  const climate = deriveClimateAuthority({ dimensions: { cols, rows }, heights, fields, biomeWeights }, recipe);
  for (let y = 0; y < rows; y += 1) {
    const materials = [];
    for (let x = 0; x < cols; x += 1) {
      let material = dominantMaterial(Object.fromEntries(BIOMES.map((biome) => [biome, biomeWeights[biome][y][x]])));
      if (material !== "water" && [[1, 0], [0, 1], [-1, 0], [0, -1]].some(([dx, dy]) => fields.water[y + dy]?.[x + dx] > 0.45)) material = "shore";
      const legend = ["grass", "field", "dirt", "stone", "water", "settlement", "cobble", "rock", "ruin", "shore"];
      materials.push(legend.indexOf(material).toString(36));
    }
    materialRows[y] = materials.join("");
  }
  const hydrologyAuthority = buildHydrologyAuthority({
    directions: hydrology.directions,
    accumulation: hydrology.accumulation,
    water: fields.water,
    lake: fields.lake,
    tributaries,
    watershedOutletBucketTiles: recipe.hydrology.watershedOutletBucketTiles,
    shorelineThreshold: recipe.hydrology.shorelineThreshold,
  });
  const waterAuthority = buildWaterAuthority({
    elevationVertices: heights,
    water: fields.water,
    river: fields.river,
    lake: fields.lake,
    directions: hydrology.directions,
    filledElevation: hydrology.filled,
    accumulation: hydrology.accumulation,
    samplesPerTile: 1,
    unitsPerTile,
  });
  const bundle = {
    schema: "duskfell-world-bundle-v2",
    version: "2.0.0",
    id: recipe.id,
    seed: recipe.seed,
    dimensions: { cols, rows, unitsPerTile, width: cols * unitsPerTile, height: rows * unitsPerTile },
    projection: "military-plan-oblique",
    sourceRecipe: "recipe.json",
    authority: {
      schema: "duskfell-terrain-authority-v1",
      samplesPerTile: 1,
      vertexCols: cols + 1,
      vertexRows: rows + 1,
      cellCols: cols,
      cellRows: rows,
      preErosionElevation: preErosionHeights,
      erosionDelta: matrix(erosion.delta, cols + 1, rows + 1, (value) => value),
      elevation: heights,
      water: fields.water,
      river: fields.river,
      snow: fields.snow,
    },
    heights,
    fields,
    biomeWeights,
    climate,
    waterAuthority,
    hydrology: {
      flowDirectionD8: matrix(hydrology.directions, cols, rows),
      flowAccumulation: matrix(hydrology.accumulation, cols, rows, (value) => round(value, 3)),
      depressionFillDepth: matrix(hydrology.fillDepth, cols, rows, (value) => round(value, 6)),
      riverCenterline,
      lake: recipe.terrain.lake,
      authority: hydrologyAuthority,
    },
    legacy: {
      cols,
      rows,
      materialGrid: materialRows,
      heights: heights.map((row) => row.map((value) => round(value * 2, 3))),
      heathWeights: grid(rows + 1, cols + 1, (x, y) => round(biomeWeights.loam[Math.min(rows - 1, y)][Math.min(cols - 1, x)])),
      vegetation: fields.vegetation,
    },
    generation: {
      deterministic: true,
      algorithm: "duskfell-valley-v2",
      erosion: erosion.metadata,
      palette: recipe.palette,
      terrainAuthoring: { schema: "duskfell-terrain-authoring-v1", operationCount: terrainOperations.length },
    },
  };
  const weightedBundle = attachMaterialWeights(bundle);
  weightedBundle.contentSha256 = crypto.createHash("sha256").update(JSON.stringify(weightedBundle)).digest("hex");
  return weightedBundle;
}

function parseHex(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function blendColors(weights, palette) {
  const color = [0, 0, 0];
  for (const biome of BIOMES) {
    const source = parseHex(palette[biome]);
    for (let i = 0; i < 3; i += 1) color[i] += source[i] * weights[biome];
  }
  return color;
}

function blendMaterialColors(bundle, recipe, x, y) {
  const colors = {
    meadow: parseHex(recipe.palette.meadow),
    loam: parseHex(recipe.palette.loam),
    wetSoil: [70, 78, 62],
    riverBank: [91, 79, 60],
    beach: [132, 124, 101],
    scree: [91, 91, 87],
    cliff: [72, 73, 72],
    snow: parseHex(recipe.palette.snow),
    water: parseHex(recipe.palette.water),
    road: [103, 86, 61],
    settlement: [113, 105, 88],
  };
  const color = [0, 0, 0];
  for (const family of bundle.materialWeights.families) {
    const amount = sampleGrid(bundle.materialWeights.weights[family], x, y);
    for (let channel = 0; channel < 3; channel += 1) color[channel] += colors[family][channel] * amount;
  }
  return color;
}

function sampleGrid(field, x, y) {
  const rows = field.length;
  const cols = field[0].length;
  const x0 = clamp(Math.floor(x), 0, cols - 1);
  const y0 = clamp(Math.floor(y), 0, rows - 1);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const tx = clamp(x - x0);
  const ty = clamp(y - y0);
  return (field[y0][x0] * (1 - tx) + field[y0][x1] * tx) * (1 - ty) + (field[y1][x0] * (1 - tx) + field[y1][x1] * tx) * ty;
}

export function renderStructural(bundle, recipe, outputPath, pixelsPerTile) {
  const width = bundle.dimensions.cols * pixelsPerTile;
  const height = bundle.dimensions.rows * pixelsPerTile;
  const detailRatio = clamp(pixelsPerTile / recipe.macro.gameplayPixelsPerTile, 0, 1);
  const authority = bundle.authority?.schema === "duskfell-terrain-authority-v1" ? bundle.authority : null;
  const authorityScale = authority?.samplesPerTile ?? 1;
  const rgb = Buffer.alloc(width * height * 3);
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const x = px / pixelsPerTile;
      const y = py / pixelsPerTile;
      const weights = Object.fromEntries(BIOMES.map((biome) => [biome, sampleGrid(bundle.biomeWeights[biome], x, y)]));
      if (authority) applyAuthorityBiomes(weights, authority, x * authorityScale, y * authorityScale);
      let color = bundle.materialWeights
        ? blendMaterialColors(bundle, recipe, x, y)
        : blendColors(weights, recipe.palette);
      const trail = bundle.fields.trail ? sampleGrid(bundle.fields.trail, x, y) * (1 - weights.water) : 0;
      const settlement = bundle.fields.settlement ? sampleGrid(bundle.fields.settlement, x, y) * (1 - weights.water) : 0;
      color = mixColor(color, [103, 86, 61], trail * 0.58);
      color = mixColor(color, [113, 105, 88], settlement * 0.5);
      const heightField = authority?.elevation ?? bundle.heights;
      const heightX = x * authorityScale;
      const heightY = y * authorityScale;
      const heightStep = authority ? Math.max(1, authorityScale * 0.25) : 0.25;
      const h = sampleGrid(heightField, heightX, heightY);
      const hx = sampleGrid(heightField, heightX + heightStep, heightY) - sampleGrid(heightField, heightX - heightStep, heightY);
      const hy = sampleGrid(heightField, heightX, heightY + heightStep) - sampleGrid(heightField, heightX, heightY - heightStep);
      const hillshade = clamp(0.88 - hx * 1.7 - hy * 1.15 + h * 0.08, 0.64, 1.14);
      const grainFrequency = 0.8 + detailRatio * 2.2;
      const grainStrength = weights.water > 0.45 ? 1.5 * detailRatio : 3 + detailRatio * 6;
      const grain = (fbm(x * grainFrequency, y * grainFrequency, bundle.seed + 199) - 0.5) * grainStrength;
      color = color.map((value) => clamp(Math.round(value * hillshade + grain), 0, 255));
      const offset = (py * width + px) * 3;
      rgb[offset] = color[0]; rgb[offset + 1] = color[1]; rgb[offset + 2] = color[2];
    }
  }
  const ppm = `${outputPath}.ppm`;
  fs.writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), rgb]));
  execFileSync("magick", [ppm, "-define", "png:compression-level=9", outputPath]);
  fs.unlinkSync(ppm);
  return { path: path.basename(outputPath), width, height, pixelsPerTile, sha256: crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex") };
}

function applyAuthorityBiomes(weights, authority, x, y) {
  const water = Math.max(weights.water, sampleGrid(authority.water, x, y));
  const snow = Math.max(weights.snow, sampleGrid(authority.snow, x, y) * (1 - water));
  const terrestrial = BIOMES.filter((biome) => biome !== "water" && biome !== "snow");
  const terrestrialTotal = terrestrial.reduce((sum, biome) => sum + weights[biome], 0) || 1;
  const terrestrialBudget = Math.max(0, 1 - water - snow);
  for (const biome of terrestrial) weights[biome] = weights[biome] / terrestrialTotal * terrestrialBudget;
  weights.water = water;
  weights.snow = snow;
}

function mixColor(base, overlay, amount) {
  return base.map((value, index) => value * (1 - amount) + overlay[index] * amount);
}

function matrix(values, cols, rows, map = (value) => value) {
  return Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => map(values[y * cols + x])));
}

export function buildWorld(recipePath = DEFAULT_RECIPE, options = {}) {
  const recipe = JSON.parse(fs.readFileSync(recipePath, "utf8"));
  const outputDir = options.outputDir ? path.resolve(options.outputDir) : path.dirname(recipePath);
  fs.mkdirSync(outputDir, { recursive: true });
  const packagedRecipePath = path.join(outputDir, "recipe.json");
  if (path.resolve(recipePath) !== packagedRecipePath) {
    fs.writeFileSync(packagedRecipePath, `${JSON.stringify(recipe, null, 2)}\n`);
  }
  let authoring = null;
  if (options.authoringPatch) {
    const authoringPath = path.join(outputDir, "authoring-patch.json");
    fs.writeFileSync(authoringPath, `${JSON.stringify(options.authoringPatch, null, 2)}\n`);
    authoring = {
      path: path.basename(authoringPath),
      sha256: crypto.createHash("sha256").update(fs.readFileSync(authoringPath)).digest("hex"),
      sourceWorld: options.authoringPatch.source.world,
      sourceBundleContentSha256: options.authoringPatch.source.bundleContentSha256,
    };
  }
  const generatedBundle = options.bundle ?? generateWorld(recipe);
  const plannedBundle = recipe.planning
    ? options.authoredFeatures
      ? applyAuthoredFeatures(generatedBundle, recipe, options.authoredFeatures)
      : planWorldFeatures(generatedBundle, recipe)
    : generatedBundle;
  const bundle = recipe.ecology
    ? composeWorldEcology(plannedBundle, recipe, { landmarks: options.authoredFeatures?.landmarks })
    : plannedBundle;
  const bundlePath = path.join(outputDir, "world-bundle-v2.json");
  fs.writeFileSync(bundlePath, `${JSON.stringify(bundle)}\n`);
  const vertexHeightPrecision = 1000;
  const serverPatch = {
    schema: "duskfell-server-world-patch-v1",
    world: bundle.id,
    targetWorld: {
      cols: recipe.placement?.targetCols ?? 192,
      rows: recipe.placement?.targetRows ?? 128,
      unitsPerTile: bundle.dimensions.unitsPerTile,
    },
    region: {
      offsetX: recipe.placement?.offsetX ?? 64,
      offsetY: recipe.placement?.offsetY ?? 32,
      cols: bundle.dimensions.cols,
      rows: bundle.dimensions.rows,
    },
    authority: {
      materialGrid: bundle.legacy.materialGrid,
      vertexHeightPrecision,
      vertexHeights: bundle.legacy.heights.map((row) => row.map((height) => Math.round(height * vertexHeightPrecision))),
      minElevation: -1,
      maxElevation: 2,
      waterLevel: -1,
      maxWalkableStep: 1
    },
    features: bundle.features,
    canonicalTerrain: bundle.authority ?? null,
    sourceBundleSha256: crypto.createHash("sha256").update(fs.readFileSync(bundlePath)).digest("hex"),
    activation: "review-only; merge into server/data/world.json during an explicit world wipe"
  };
  const serverPatchPath = path.join(outputDir, "server-authority-patch.json");
  fs.writeFileSync(serverPatchPath, `${JSON.stringify(serverPatch, null, 2)}\n`);
  const terrainDetailPatch = buildTerrainDetailAuthorityPatch(bundle, recipe);
  const terrainDetailPatchPath = path.join(outputDir, "terrain-detail-authority-patch.json");
  fs.writeFileSync(terrainDetailPatchPath, `${JSON.stringify(terrainDetailPatch, null, 2)}\n`);
  const rasters = {
    gameplay: renderStructural(bundle, recipe, path.join(outputDir, "gameplay-master.png"), recipe.macro.gameplayPixelsPerTile),
    travel: renderStructural(bundle, recipe, path.join(outputDir, "travel-lod.png"), recipe.macro.travelPixelsPerTile ?? 16),
    worldMap: renderStructural(bundle, recipe, path.join(outputDir, "world-map-lod.png"), recipe.macro.worldMapPixelsPerTile ?? 8),
  };
  const ecologyReviewPath = path.join(outputDir, "ecology-review.png");
  const ecologyReview = renderEcologyReview(bundle, recipe, path.join(outputDir, "gameplay-master.png"), ecologyReviewPath);
  const reviewSheetPath = path.join(outputDir, "review-sheet.png");
  execFileSync("magick", [
    "montage",
    path.join(outputDir, "gameplay-master.png"),
    path.join(outputDir, "travel-lod.png"),
    path.join(outputDir, "world-map-lod.png"),
    ecologyReviewPath,
    "-thumbnail", "640x640",
    "-tile", "4x1",
    "-geometry", "+16+16",
    "-background", "#111111",
    reviewSheetPath,
  ]);
  const chunkIndex = writeWorldChunks(bundle, recipe, outputDir);
  const chunkVisualControls = writeChunkVisualControls(
    outputDir,
    bundle,
    recipe,
    chunkIndex,
    rasters.gameplay,
  );
  const manifest = {
    schema: "duskfell-world-render-manifest-v4",
    state: "review",
    world: bundle.id,
    recipe: "recipe.json",
    recipeSha256: crypto.createHash("sha256").update(fs.readFileSync(packagedRecipePath)).digest("hex"),
    bundle: "world-bundle-v2.json",
    bundleSha256: crypto.createHash("sha256").update(fs.readFileSync(bundlePath)).digest("hex"),
    serverPatch: "server-authority-patch.json",
    terrainDetailPatch: {
      path: "terrain-detail-authority-patch.json",
      sha256: crypto.createHash("sha256").update(fs.readFileSync(terrainDetailPatchPath)).digest("hex"),
    },
    source: recipe.source ?? { type: "synthetic-v2", model: "legacy-unrecorded" },
    sourceArtifact: options.sourceArtifact ?? null,
    authoring,
    rasters,
    ecologyReview,
    reviewSheet: {
      path: "review-sheet.png",
      sha256: crypto.createHash("sha256").update(fs.readFileSync(reviewSheetPath)).digest("hex"),
    },
    macro: recipe.macro,
    chunkIndex,
    chunkVisuals: {
      control: chunkVisualControls,
    },
  };
  fs.writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { bundlePath, bundle, manifest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = buildWorld(process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_RECIPE);
  console.log(JSON.stringify({ bundle: path.relative(ROOT, result.bundlePath), fields: Object.keys(result.bundle.fields), rasters: result.manifest.rasters }, null, 2));
}
