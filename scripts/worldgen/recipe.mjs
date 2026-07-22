import fs from "node:fs";
import path from "node:path";

export const RECIPE_SCHEMA = "duskfell-world-recipe-v3";
export const SOURCE_TYPES = new Set(["synthetic-v2", "terrain-diffusion", "atlas-region-v1"]);

const TERRAIN_DIFFUSION_30M_SOURCE = Object.freeze({
  type: "terrain-diffusion",
  repository: "https://github.com/xandergos/terrain-diffusion",
  license: "MIT",
  model: "xandergos/terrain-diffusion-30m",
  region: Object.freeze({ i: 768, j: 768 }),
  scale: 2,
  samplesPerTile: 2,
});

const SOURCE_MODEL_PRESETS = new Map([
  ["terrain-diffusion-30m", TERRAIN_DIFFUSION_30M_SOURCE],
  ["xandergos/terrain-diffusion-30m", TERRAIN_DIFFUSION_30M_SOURCE],
]);

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIRED_PALETTE = ["meadow", "loam", "rock", "snow", "wetland", "water"];
const COMPOSITOR_ASSET_ROLES = [...REQUIRED_PALETTE, "trail", "settlement"];

export function readRecipe(recipePath) {
  const resolved = path.resolve(recipePath);
  let recipe;
  try {
    recipe = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new Error(`unable to read world recipe ${resolved}: ${error.message}`);
  }
  return validateRecipe(recipe);
}

export function validateRecipe(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("world recipe must be an object");
  }
  if (input.schema !== RECIPE_SCHEMA) throw new Error(`world recipe schema must be ${RECIPE_SCHEMA}`);
  if (!SAFE_ID.test(input.id ?? "")) throw new Error("world recipe id must be a lowercase kebab-case identifier");
  integer(input.seed, "seed", 0, 0x7fffffff);

  const dimensions = object(input.dimensions, "dimensions");
  integer(dimensions.cols, "dimensions.cols", 16, 512);
  integer(dimensions.rows, "dimensions.rows", 16, 512);
  if (dimensions.cols * dimensions.rows > 131072) throw new Error("world recipe exceeds the 131072 tile generation cap");
  integer(dimensions.unitsPerTile, "dimensions.unitsPerTile", 16, 256);
  if (dimensions.unitsPerTile !== 64) throw new Error("dimensions.unitsPerTile must preserve the 64-unit projection contract");

  const source = object(input.source, "source");
  if (!SOURCE_TYPES.has(source.type)) throw new Error(`source.type must be one of ${[...SOURCE_TYPES].join(", ")}`);
  nonempty(source.repository, "source.repository");
  nonempty(source.license, "source.license");
  nonempty(source.model, "source.model");
  if (source.type === "terrain-diffusion") {
    const region = object(source.region, "source.region");
    integer(region.i, "source.region.i", -100000000, 100000000);
    integer(region.j, "source.region.j", -100000000, 100000000);
    integer(source.scale, "source.scale", 1, 8);
    if (![1, 2, 4, 8].includes(source.scale)) throw new Error("source.scale must be one of 1, 2, 4, or 8");
    integer(source.samplesPerTile, "source.samplesPerTile", 1, 8);
  } else if (source.type === "atlas-region-v1") {
    if (source.model !== "duskfell-atlas-region-v1") throw new Error("atlas-region-v1 recipes must use model duskfell-atlas-region-v1");
    integer(source.samplesPerTile, "source.samplesPerTile", 2, 4);
    const region = object(source.region, "source.region");
    integer(region.x, "source.region.x", 0, 127);
    integer(region.y, "source.region.y", 0, 127);
    const atlas = object(source.atlas, "source.atlas");
    nonempty(atlas.id, "source.atlas.id");
    for (const key of ["contentSha256", "manifestSha256", "regionDescriptorSha256", "parentAuthoritySha256"]) {
      if (!/^[0-9a-f]{64}$/.test(atlas[key] ?? "")) throw new Error(`source.atlas.${key} must be a lowercase SHA-256 digest`);
    }
  } else if (source.model !== "duskfell-synthetic-v2") {
    throw new Error("synthetic-v2 recipes must use model duskfell-synthetic-v2");
  }

  const placement = object(input.placement, "placement");
  integer(placement.targetCols, "placement.targetCols", dimensions.cols, 1024);
  integer(placement.targetRows, "placement.targetRows", dimensions.rows, 1024);
  integer(placement.offsetX, "placement.offsetX", 0, placement.targetCols - dimensions.cols);
  integer(placement.offsetY, "placement.offsetY", 0, placement.targetRows - dimensions.rows);

  const macro = object(input.macro, "macro");
  integer(macro.tiles, "macro.tiles", 8, 128);
  integer(macro.apronTiles, "macro.apronTiles", 1, 32);
  integer(macro.gameplayPixelsPerTile, "macro.gameplayPixelsPerTile", 8, 64);
  integer(macro.travelPixelsPerTile, "macro.travelPixelsPerTile", 2, macro.gameplayPixelsPerTile);
  integer(macro.worldMapPixelsPerTile, "macro.worldMapPixelsPerTile", 1, macro.travelPixelsPerTile);

  const terrain = object(input.terrain, "terrain");
  finite(terrain.valleyCenterX, "terrain.valleyCenterX", 0, dimensions.cols);
  finite(terrain.valleyHalfWidth, "terrain.valleyHalfWidth", 2, dimensions.cols);
  finite(terrain.snowline, "terrain.snowline", 0, 1);
  finite(terrain.riverWidth, "terrain.riverWidth", 0.25, 8);
  const lake = object(terrain.lake, "terrain.lake");
  finite(lake.x, "terrain.lake.x", 0, dimensions.cols);
  finite(lake.y, "terrain.lake.y", 0, dimensions.rows);
  finite(lake.radiusX, "terrain.lake.radiusX", 1, dimensions.cols / 2);
  finite(lake.radiusY, "terrain.lake.radiusY", 1, dimensions.rows / 2);

  const erosion = object(input.erosion, "erosion");
  if (typeof erosion.enabled !== "boolean") throw new Error("erosion.enabled must be a boolean");
  integer(erosion.iterations, "erosion.iterations", 0, 64);
  finite(erosion.rainfall, "erosion.rainfall", 0, 0.2);
  finite(erosion.evaporation, "erosion.evaporation", 0, 1);
  finite(erosion.flowRate, "erosion.flowRate", 0, 2);
  finite(erosion.sedimentCapacity, "erosion.sedimentCapacity", 0, 20);
  finite(erosion.erosionRate, "erosion.erosionRate", 0, 1);
  finite(erosion.depositionRate, "erosion.depositionRate", 0, 1);
  finite(erosion.minimumSlope, "erosion.minimumSlope", 0, 1);
  finite(erosion.talus, "erosion.talus", 0, 1);
  finite(erosion.thermalRate, "erosion.thermalRate", 0, 1);
  if ((source.type === "terrain-diffusion" || source.type === "atlas-region-v1") && erosion.enabled) {
    const apronSamples = input.macro.apronTiles * source.samplesPerTile;
    const propagationRadius = erosion.iterations * (erosion.thermalRate > 0 ? 2 : 1) + 2;
    if (propagationRadius > apronSamples) throw new Error("erosion propagation radius must fit inside the source apron");
  }

  const hydrology = object(input.hydrology, "hydrology");
  integer(hydrology.maxTributaries, "hydrology.maxTributaries", 1, 8);
  integer(hydrology.minTributaryLengthTiles, "hydrology.minTributaryLengthTiles", 3, Math.max(dimensions.cols, dimensions.rows));
  integer(hydrology.watershedOutletBucketTiles, "hydrology.watershedOutletBucketTiles", 2, Math.min(dimensions.cols, dimensions.rows));
  finite(hydrology.shorelineThreshold, "hydrology.shorelineThreshold", 0.1, 0.9);

  const climate = object(input.climate, "climate");
  finite(climate.latitudeSouthDegrees, "climate.latitudeSouthDegrees", -70, 70);
  finite(climate.latitudeNorthDegrees, "climate.latitudeNorthDegrees", -70, 70);
  if (climate.latitudeNorthDegrees <= climate.latitudeSouthDegrees) throw new Error("climate latitude range must run south to north");
  if (climate.prevailingWind !== "west-to-east") throw new Error("climate.prevailingWind currently supports west-to-east");
  finite(climate.annualTemperature, "climate.annualTemperature", 0, 1);
  finite(climate.latitudeCooling, "climate.latitudeCooling", 0, 0.5);
  finite(climate.elevationLapse, "climate.elevationLapse", 0.1, 1);
  finite(climate.seasonalAmplitude, "climate.seasonalAmplitude", 0, 0.6);
  finite(climate.oceanMoisture, "climate.oceanMoisture", 0.1, 1);
  finite(climate.orographicLift, "climate.orographicLift", 0.1, 3);
  finite(climate.waterHumidityRadiusTiles, "climate.waterHumidityRadiusTiles", 1, Math.max(dimensions.cols, dimensions.rows));
  finite(climate.fogHumidityThreshold, "climate.fogHumidityThreshold", 0.4, 0.95);

  const planning = object(input.planning, "planning");
  integer(planning.settlements, "planning.settlements", 2, 8);
  integer(planning.minSettlementSpacing, "planning.minSettlementSpacing", 3, Math.min(dimensions.cols, dimensions.rows));
  finite(planning.maxTrailSlope, "planning.maxTrailSlope", 0.1, 1);
  finite(planning.trailWidth, "planning.trailWidth", 0.4, 3);

  const ecology = object(input.ecology, "ecology");
  integer(ecology.maxResourceNodes, "ecology.maxResourceNodes", 8, 256);
  finite(ecology.minResourceSpacingTiles, "ecology.minResourceSpacingTiles", 0.5, 8);
  integer(ecology.minHabitatPatchTiles, "ecology.minHabitatPatchTiles", 1, 256);
  integer(ecology.landmarkCount, "ecology.landmarkCount", 1, 4);
  finite(ecology.minLandmarkSpacingTiles, "ecology.minLandmarkSpacingTiles", 3, Math.min(dimensions.cols, dimensions.rows));

  const palette = object(input.palette, "palette");
  for (const key of REQUIRED_PALETTE) {
    if (!/^#[0-9a-f]{6}$/i.test(palette[key] ?? "")) throw new Error(`palette.${key} must be a six-digit hex color`);
  }

  const illustration = object(input.illustration, "illustration");
  if (typeof illustration.enabled !== "boolean") throw new Error("illustration.enabled must be a boolean");
  if (illustration.execution !== undefined && !["regional-v1", "chunked-v1"].includes(illustration.execution)) {
    throw new Error("illustration.execution must be regional-v1 or chunked-v1");
  }
  nonempty(illustration.provider, "illustration.provider");
  nonempty(illustration.model, "illustration.model");
  if (!["structural-raster-v1", "blender-heightfield-v1"].includes(illustration.controlRenderer)) throw new Error("illustration.controlRenderer is unsupported");
  integer(illustration.controlSamplesPerTile, "illustration.controlSamplesPerTile", 1, 8);
  finite(illustration.strength, "illustration.strength", 0, 1);
  integer(illustration.steps, "illustration.steps", 1, 100);
  finite(illustration.cfgScale, "illustration.cfgScale", 0, 20);
  nonempty(illustration.sampler, "illustration.sampler");
  integer(illustration.maxLongEdge, "illustration.maxLongEdge", 512, 1536);
  nonempty(illustration.promptVersion, "illustration.promptVersion");
  nonempty(illustration.prompt, "illustration.prompt");
  if (illustration.inputAssets !== undefined) validateInputAssets(illustration.inputAssets);
  if (illustration.provider === "duskfell-authority-compositor") {
    const inputAssets = object(illustration.inputAssets, "illustration.inputAssets");
    for (const role of COMPOSITOR_ASSET_ROLES) {
      if (!inputAssets[role]) throw new Error(`illustration.inputAssets.${role} is required for the authority compositor`);
    }
  }
  const gates = object(illustration.gates, "illustration.gates");
  finite(gates.waterF1, "illustration.gates.waterF1", 0, 1);
  finite(gates.snowF1, "illustration.gates.snowF1", 0, 1);
  finite(gates.riverCenterOffsetTiles, "illustration.gates.riverCenterOffsetTiles", 0, 8);
  finite(gates.trailRecall, "illustration.gates.trailRecall", 0, 1);
  finite(gates.settlementRecall, "illustration.gates.settlementRecall", 0, 1);
  finite(gates.minEntropy, "illustration.gates.minEntropy", 0, 1);
  finite(gates.minEdgeEnergy, "illustration.gates.minEdgeEnergy", 0, 1);

  return structuredClone(input);
}

export function applyRecipeOverrides(recipe, overrides) {
  const next = structuredClone(recipe);
  if (overrides.id !== undefined) next.id = overrides.id;
  if (overrides.seed !== undefined) next.seed = parseInteger(overrides.seed, "--seed");
  if (overrides.size !== undefined) {
    const match = /^(\d+)x(\d+)$/i.exec(overrides.size);
    if (!match) throw new Error("--size must use COLSxROWS, for example 192x128");
    next.dimensions.cols = Number(match[1]);
    next.dimensions.rows = Number(match[2]);
    next.terrain.valleyCenterX = (next.dimensions.cols - 1) / 2;
    next.terrain.valleyHalfWidth = Math.max(4, next.dimensions.cols * 0.265625);
    next.terrain.lake = {
      x: next.dimensions.cols * 0.53125,
      y: next.dimensions.rows * 0.671875,
      radiusX: Math.max(2, next.dimensions.cols * 0.1171875),
      radiusY: Math.max(2, next.dimensions.rows * 0.0859375),
    };
    next.planning.minSettlementSpacing = Math.min(
      next.planning.minSettlementSpacing,
      Math.max(3, Math.floor(Math.min(next.dimensions.cols, next.dimensions.rows) / next.planning.settlements)),
    );
    next.ecology.maxResourceNodes = Math.min(next.ecology.maxResourceNodes, Math.max(8, Math.floor(next.dimensions.cols * next.dimensions.rows / 3)));
    next.ecology.minHabitatPatchTiles = Math.min(next.ecology.minHabitatPatchTiles, Math.max(1, Math.floor(next.dimensions.cols * next.dimensions.rows / 32)));
    next.ecology.minLandmarkSpacingTiles = Math.min(
      next.ecology.minLandmarkSpacingTiles,
      Math.max(3, Math.floor(Math.min(next.dimensions.cols, next.dimensions.rows) / 3)),
    );
    next.hydrology.minTributaryLengthTiles = Math.min(next.hydrology.minTributaryLengthTiles, Math.max(3, Math.floor(Math.min(next.dimensions.cols, next.dimensions.rows) / 3)));
    next.hydrology.watershedOutletBucketTiles = Math.min(next.hydrology.watershedOutletBucketTiles, Math.max(2, Math.floor(Math.min(next.dimensions.cols, next.dimensions.rows) / 4)));
    if (next.dimensions.cols > next.placement.targetCols || next.dimensions.rows > next.placement.targetRows) {
      next.placement = {
        targetCols: next.dimensions.cols,
        targetRows: next.dimensions.rows,
        offsetX: 0,
        offsetY: 0,
      };
    } else {
      next.placement.offsetX = Math.floor((next.placement.targetCols - next.dimensions.cols) / 2);
      next.placement.offsetY = Math.floor((next.placement.targetRows - next.dimensions.rows) / 2);
    }
  }
  if (overrides.model !== undefined) {
    const preset = SOURCE_MODEL_PRESETS.get(overrides.model);
    if (preset) {
      next.source = structuredClone(preset);
    } else {
      next.source.model = overrides.model;
    }
  }
  if (overrides.illustration !== undefined) {
    if (!["on", "off"].includes(overrides.illustration)) throw new Error("--illustration must be on or off");
    next.illustration.enabled = overrides.illustration === "on";
  }
  return validateRecipe(next);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function nonempty(value, label) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2000) {
    throw new Error(`${label} must be a non-empty bounded string`);
  }
}

function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer between ${min} and ${max}`);
}

function finite(value, label, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}`);
}

function parseInteger(value, label) {
  if (!/^-?\d+$/.test(value)) throw new Error(`${label} must be an integer`);
  return Number(value);
}

function validateInputAssets(value) {
  const assets = object(value, "illustration.inputAssets");
  const entries = Object.entries(assets);
  if (entries.length < 1 || entries.length > 32) throw new Error("illustration.inputAssets must contain 1-32 pinned assets");
  for (const [role, reference] of entries) {
    if (!SAFE_ID.test(role)) throw new Error(`illustration.inputAssets role ${role} is invalid`);
    object(reference, `illustration.inputAssets.${role}`);
    if (!/^assets\/terrain\/ground-patches\/[a-z0-9][a-z0-9.-]*$/.test(reference.path ?? "")) {
      throw new Error(`illustration.inputAssets.${role}.path is unsafe`);
    }
    if (!/^[0-9a-f]{64}$/.test(reference.sha256 ?? "")) {
      throw new Error(`illustration.inputAssets.${role}.sha256 must be a lowercase SHA-256 digest`);
    }
  }
}
