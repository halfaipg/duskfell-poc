import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { validateAtlasPackage } from "./atlas-validator.mjs";
import { validateRecipe } from "./recipe.mjs";
import { generateTerrainDiffusionWorld, parseTerrainDiffusionPayload } from "./terrain-diffusion-source.mjs";

const ELEVATION_METERS = 3200;

export function loadAtlasRegionContext(atlasPackage, coord) {
  const root = path.resolve(atlasPackage);
  validateAtlasPackage(root, { writeReport: false });
  const atlas = readJson(path.join(root, "atlas.json"), "atlas authority");
  const atlasRecipe = readJson(path.join(root, "recipe.json"), "atlas recipe");
  const regionIndex = readJson(path.join(root, "regions", "index.json"), "atlas region index");
  const manifestPath = path.join(root, "manifest.json");
  const manifest = readJson(manifestPath, "atlas manifest");
  const descriptor = regionIndex.regions.find((region) => region.coord.x === coord.x && region.coord.y === coord.y);
  if (!descriptor) throw new Error(`atlas region ${coord.x},${coord.y} is outside the continent`);
  return { root, atlas, atlasRecipe, regionIndex, manifest, manifestSha256: sha256(manifestPath), descriptor };
}

export function deriveAtlasRegionRecipe(templateInput, context) {
  const template = structuredClone(templateInput);
  const { atlas, atlasRecipe, descriptor } = context;
  const latitudeNorthDegrees = lerp(atlas.climate.latitudeNorthDegrees, atlas.climate.latitudeSouthDegrees, descriptor.coord.y / atlas.dimensions.regionRows);
  const latitudeSouthDegrees = lerp(atlas.climate.latitudeNorthDegrees, atlas.climate.latitudeSouthDegrees, (descriptor.coord.y + 1) / atlas.dimensions.regionRows);
  template.id = descriptor.id;
  template.seed = descriptor.seed;
  template.dimensions = structuredClone(descriptor.dimensions);
  template.placement = { targetCols: descriptor.dimensions.cols, targetRows: descriptor.dimensions.rows, offsetX: 0, offsetY: 0 };
  template.macro.tiles = atlas.chunks.tiles;
  template.macro.apronTiles = atlas.chunks.apronTiles;
  template.terrain.valleyCenterX = (descriptor.dimensions.cols - 1) / 2;
  template.terrain.valleyHalfWidth = descriptor.dimensions.cols * 0.27;
  template.terrain.lake = {
    x: descriptor.dimensions.cols * 0.53,
    y: descriptor.dimensions.rows * 0.67,
    radiusX: descriptor.dimensions.cols * 0.11,
    radiusY: descriptor.dimensions.rows * 0.09,
  };
  template.climate.latitudeSouthDegrees = round(latitudeSouthDegrees);
  template.climate.latitudeNorthDegrees = round(latitudeNorthDegrees);
  template.climate.prevailingWind = atlas.climate.prevailingWind;
  template.climate.elevationLapse = atlas.climate.elevationLapse;
  template.climate.orographicLift = atlas.climate.orographicLift;
  template.source = {
    type: "atlas-region-v1",
    repository: atlasRecipe.source.repository,
    license: atlasRecipe.source.license,
    model: "duskfell-atlas-region-v1",
    samplesPerTile: 2,
    region: structuredClone(descriptor.coord),
    atlas: {
      id: atlas.id,
      contentSha256: atlas.contentSha256,
      manifestSha256: context.manifestSha256,
      regionDescriptorSha256: descriptor.descriptorSha256,
      parentAuthoritySha256: descriptor.parentAuthoritySha256,
    },
  };
  template.illustration.enabled = false;
  return validateRecipe(template);
}

export function buildAtlasRegionSource(recipe, context) {
  const { atlas, descriptor } = context;
  assertRecipeBinding(recipe, context);
  const samples = recipe.source.samplesPerTile;
  const apronSamples = recipe.macro.apronTiles * samples;
  const width = recipe.dimensions.cols * samples + apronSamples * 2 + 1;
  const height = recipe.dimensions.rows * samples + apronSamples * 2 + 1;
  const cells = width * height;
  const raw = Buffer.alloc(cells * 18);
  const climateOffset = cells * 2;
  const apronTiles = recipe.macro.apronTiles;
  const bounds = {
    minX: descriptor.tileOrigin.x - apronTiles,
    minY: descriptor.tileOrigin.y - apronTiles,
    maxX: descriptor.tileOrigin.x + descriptor.dimensions.cols + apronTiles,
    maxY: descriptor.tileOrigin.y + descriptor.dimensions.rows + apronTiles,
  };
  const riverSegments = atlas.drainage.riverSegments.filter((segment) => {
    const padding = segment.widthTiles * 1.2;
    return Math.max(...segment.points.map((point) => point.x)) + padding >= bounds.minX
      && Math.min(...segment.points.map((point) => point.x)) - padding <= bounds.maxX
      && Math.max(...segment.points.map((point) => point.y)) + padding >= bounds.minY
      && Math.min(...segment.points.map((point) => point.y)) - padding <= bounds.maxY;
  });
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const globalX = descriptor.tileOrigin.x + (x - apronSamples) / samples;
    const globalY = descriptor.tileOrigin.y + (y - apronSamples) / samples;
    const atlasX = globalX / atlas.dimensions.worldTiles.cols * (atlas.sampling.cols - 1);
    const atlasY = globalY / atlas.dimensions.worldTiles.rows * (atlas.sampling.rows - 1);
    const baseElevation = sampleGrid(atlas.fields.elevation, atlasX, atlasY);
    const landPressure = smoothstep(atlas.climate.seaLevel - 0.08, atlas.climate.seaLevel + 0.12, baseElevation);
    const detail = (fbm(globalX / 54, globalY / 54, atlas.seed + 1709) - 0.5) * 0.11
      + (1 - Math.abs(fbm(globalX / 31, globalY / 31, atlas.seed + 3251) * 2 - 1)) * landPressure * 0.035;
    const elevation = clamp(baseElevation + detail * (0.35 + landPressure * 0.65));
    const temperature = clamp(sampleGrid(atlas.fields.temperature, atlasX, atlasY) + (fbm(globalX / 96, globalY / 96, atlas.seed + 5099) - 0.5) * 0.035);
    const precipitation = clamp(sampleGrid(atlas.fields.precipitation, atlasX, atlasY) + (fbm(globalX / 88, globalY / 88, atlas.seed + 7121) - 0.5) * 0.05);
    const humidity = clamp(sampleGrid(atlas.fields.humidity, atlasX, atlasY));
    const riverPotential = inheritedRiverPressure(globalX, globalY, riverSegments);
    const index = y * width + x;
    raw.writeInt16LE(Math.round(elevation * ELEVATION_METERS), index * 2);
    for (const [channel, value] of [temperature, riverPotential, precipitation, humidity].entries()) {
      raw.writeFloatLE(value, climateOffset + (index * 4 + channel) * 4);
    }
  }
  const source = parseTerrainDiffusionPayload(raw, width, height);
  source.normalization = {
    elevationLow: 0,
    elevationHigh: ELEVATION_METERS,
    seaLevel: atlas.climate.seaLevel * ELEVATION_METERS,
    temperatureLow: 0,
    temperatureHigh: 1,
    precipitationLow: 0,
    precipitationHigh: 1,
  };
  source.inheritedRiverChannel = 1;
  source.erosionSeed = atlas.seed;
  return source;
}

export function generateAtlasRegionWorld(recipe, source, context) {
  assertRecipeBinding(recipe, context);
  return generateTerrainDiffusionWorld(recipe, source, {
    algorithm: "atlas-region-refinement-v1",
    source: {
      repository: recipe.source.repository,
      model: recipe.source.model,
      atlas: structuredClone(recipe.source.atlas),
      region: structuredClone(recipe.source.region),
      tileOrigin: structuredClone(context.descriptor.tileOrigin),
      neighbors: structuredClone(context.descriptor.neighbors),
      samplesPerTile: recipe.source.samplesPerTile,
      payloadSha256: source.sha256,
      boundaryContract: "global-coordinate sampling with atlas-wide normalization-v1",
      hydrologyStatus: "regional priority-flood constrained by atlas drainage corridors and reciprocal edge gates",
      drainageGates: structuredClone(context.descriptor.drainageGates),
    },
  });
}

export function atlasRegionSourceMetadata(recipe, source, context) {
  return {
    schema: "duskfell-atlas-region-source-v1",
    type: recipe.source.type,
    repository: recipe.source.repository,
    license: recipe.source.license,
    model: recipe.source.model,
    atlas: structuredClone(recipe.source.atlas),
    region: structuredClone(recipe.source.region),
    tileOrigin: structuredClone(context.descriptor.tileOrigin),
    neighbors: structuredClone(context.descriptor.neighbors),
    apronTiles: recipe.macro.apronTiles,
    samplesPerTile: recipe.source.samplesPerTile,
    width: source.width,
    height: source.height,
    normalization: structuredClone(source.normalization),
    inheritedRiverChannel: source.inheritedRiverChannel,
    erosionSeed: source.erosionSeed,
    inheritedRiverRasterizer: "atlas-flow-segments-distance-field-v1",
    drainageGates: structuredClone(context.descriptor.drainageGates),
    encoding: "int16le elevation followed by four interleaved float32le climate channels",
    sha256: source.sha256,
  };
}

function assertRecipeBinding(recipe, context) {
  const { descriptor, atlas } = context;
  if (recipe.source.type !== "atlas-region-v1") throw new Error("atlas region source requires an atlas-region-v1 recipe");
  if (recipe.source.atlas.id !== atlas.id || recipe.source.atlas.contentSha256 !== atlas.contentSha256) throw new Error("region recipe atlas identity does not match validated parent authority");
  if (recipe.source.atlas.manifestSha256 !== context.manifestSha256) throw new Error("region recipe atlas manifest hash does not match");
  if (recipe.source.atlas.regionDescriptorSha256 !== descriptor.descriptorSha256 || recipe.source.atlas.parentAuthoritySha256 !== descriptor.parentAuthoritySha256) {
    throw new Error("region recipe descriptor hashes do not match parent atlas authority");
  }
  if (recipe.source.region.x !== descriptor.coord.x || recipe.source.region.y !== descriptor.coord.y) throw new Error("region recipe coordinate does not match descriptor");
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
  return (field[y0][x0] * (1 - tx) + field[y0][x1] * tx) * (1 - ty)
    + (field[y1][x0] * (1 - tx) + field[y1][x1] * tx) * ty;
}

function inheritedRiverPressure(x, y, segments) {
  let pressure = 0;
  for (const segment of segments) {
    for (let index = 0; index < segment.points.length - 1; index += 1) {
      const distance = pointSegmentDistance(x, y, segment.points[index], segment.points[index + 1]);
      pressure = Math.max(pressure, 1 - smoothstep(segment.widthTiles * 0.5, segment.widthTiles * 1.15, distance));
    }
  }
  return round(pressure);
}

function pointSegmentDistance(x, y, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared > 0 ? clamp(((x - from.x) * dx + (y - from.y) * dy) / lengthSquared) : 0;
  return Math.hypot(x - (from.x + dx * amount), y - (from.y + dy * amount));
}

function fbm(x, y, seed) {
  let total = 0;
  let amplitude = 0.56;
  let scale = 1;
  let weight = 0;
  for (let octave = 0; octave < 5; octave += 1) {
    total += valueNoise(x * scale, y * scale, seed + octave * 7919) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    scale *= 2;
  }
  return total / weight;
}

function valueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(0, 1, x - x0);
  const ty = smoothstep(0, 1, y - y0);
  const a = hash01(x0, y0, seed);
  const b = hash01(x0 + 1, y0, seed);
  const c = hash01(x0, y0 + 1, seed);
  const d = hash01(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function hash01(x, y, seed) {
  let value = Math.imul(x ^ seed, 0x45d9f3b) ^ Math.imul(y + seed, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`unable to read ${label}: ${error.message}`);
  }
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function smoothstep(a, b, value) {
  const t = clamp((value - a) / Math.max(1e-9, b - a));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Number(value.toFixed(6));
}
