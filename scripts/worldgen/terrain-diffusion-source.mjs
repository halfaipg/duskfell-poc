import crypto from "node:crypto";
import { buildHydrologyAuthority, calculatePriorityFlood, D8, extractTributaries } from "./hydrology-authority.mjs";
import { deriveClimateAuthority } from "./climate-authority.mjs";
import { erodeHeightfield } from "./erosion-authority.mjs";
import { buildWaterAuthority } from "./water-authority.mjs";
import { attachMaterialWeights } from "./material-weights.mjs";
import { validateTerrainOperations } from "../../client/world-editor-terrain-authoring.js";

const BIOMES = ["meadow", "loam", "rock", "snow", "wetland", "water"];
const MATERIALS = ["grass", "field", "dirt", "stone", "water", "settlement", "cobble", "rock", "ruin", "shore"];

export async function fetchTerrainDiffusionSource(recipe, apiBase, options = {}) {
  if (recipe.source.type !== "terrain-diffusion") throw new Error("Terrain Diffusion fetch requires a terrain-diffusion recipe");
  if (!apiBase) throw new Error("Terrain Diffusion source requires --api or TERRAIN_DIFFUSION_API");
  const { cols, rows } = recipe.dimensions;
  const samples = recipe.source.samplesPerTile;
  const apronSamples = recipe.macro.apronTiles * samples;
  const height = rows * samples + apronSamples * 2 + 1;
  const width = cols * samples + apronSamples * 2 + 1;
  const query = new URL("/terrain", ensureTrailingSlash(apiBase));
  query.searchParams.set("i1", recipe.source.region.i - apronSamples);
  query.searchParams.set("j1", recipe.source.region.j - apronSamples);
  query.searchParams.set("i2", recipe.source.region.i - apronSamples + height);
  query.searchParams.set("j2", recipe.source.region.j - apronSamples + width);
  query.searchParams.set("scale", recipe.source.scale);
  const fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const response = await fetchImpl(query, { signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!response.ok) throw new Error(`Terrain Diffusion ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const responseHeight = Number(response.headers.get("x-height"));
  const responseWidth = Number(response.headers.get("x-width"));
  if (responseHeight !== height || responseWidth !== width) {
    throw new Error(`Terrain Diffusion returned ${responseWidth}x${responseHeight}, expected ${width}x${height}`);
  }
  const raw = Buffer.from(await response.arrayBuffer());
  const expectedBytes = height * width * 18;
  if (raw.length !== expectedBytes) throw new Error(`Terrain Diffusion returned ${raw.length} bytes, expected ${expectedBytes}`);
  return parseTerrainDiffusionPayload(raw, width, height);
}

export function parseTerrainDiffusionPayload(raw, width, height) {
  const cells = width * height;
  const expectedBytes = cells * 18;
  if (!Buffer.isBuffer(raw) || raw.length !== expectedBytes) throw new Error(`terrain source payload must contain exactly ${expectedBytes} bytes`);
  const elevation = new Float64Array(cells);
  const climate = Array.from({ length: 4 }, () => new Float64Array(cells));
  for (let index = 0; index < cells; index += 1) elevation[index] = raw.readInt16LE(index * 2);
  const climateOffset = cells * 2;
  for (let index = 0; index < cells; index += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      climate[channel][index] = raw.readFloatLE(climateOffset + (index * 4 + channel) * 4);
    }
  }
  for (const [label, values] of [["elevation", elevation], ["temperature", climate[0]], ["precipitation", climate[2]]]) {
    if (![...values].every(Number.isFinite)) throw new Error(`terrain source ${label} contains non-finite values`);
  }
  return {
    raw,
    width,
    height,
    elevation,
    climate,
    sha256: crypto.createHash("sha256").update(raw).digest("hex"),
  };
}

export function applyTerrainOperationsToTerrainSource(source, recipe, operations, options = {}) {
  validateTerrainOperations(operations, recipe.dimensions);
  if (operations.length === 0) return source;
  const samples = recipe.source.samplesPerTile;
  const apronSamples = recipe.macro.apronTiles * samples;
  const seamGuardTiles = options.preserveAtlasSeams ? recipe.macro.apronTiles : 0;
  if (options.preserveAtlasSeams) {
    for (const operation of operations) assertOperationInsideAtlasSeam(operation, recipe, seamGuardTiles);
  }
  const edited = {
    ...source,
    elevation: Float64Array.from(source.elevation),
    climate: source.climate.map((channel) => Float64Array.from(channel)),
    normalization: source.normalization ? structuredClone(source.normalization) : undefined,
    rockinessDelta: new Float64Array(source.width * source.height),
    baseSha256: source.sha256,
  };
  const elevationLow = source.normalization?.elevationLow ?? percentile(source.elevation, 0.06);
  const elevationHigh = source.normalization?.elevationHigh ?? percentile(source.elevation, 0.94);
  const precipitationLow = source.normalization?.precipitationLow ?? percentile(source.climate[2], 0.04);
  const precipitationHigh = source.normalization?.precipitationHigh ?? percentile(source.climate[2], 0.96);
  edited.rockinessDelta.fill(0.5);
  let initializedAuthoredRiver = false;
  for (const operation of operations) {
    if (operation.field === "riverSpline") {
      if (source.inheritedRiverChannel !== 1 && !initializedAuthoredRiver) {
        edited.climate[1].fill(0);
        edited.inheritedRiverChannel = 1;
        initializedAuthoredRiver = true;
      }
      paintSourceRiverRoute(edited.climate[1], edited.width, edited.height, operation, recipe, apronSamples, samples);
      continue;
    }
    const target = operation.field === "elevation"
      ? edited.elevation
      : operation.field === "moisture"
        ? edited.climate[2]
        : edited.rockinessDelta;
    const low = operation.field === "elevation" ? elevationLow : operation.field === "moisture" ? precipitationLow : 0;
    const high = operation.field === "elevation" ? elevationHigh : operation.field === "moisture" ? precipitationHigh : 1;
    for (const point of operation.points) {
      applySourceBrush(target, edited.width, edited.height, {
        x: apronSamples + point.x * samples,
        y: apronSamples + point.y * samples,
      }, { ...operation, radius: operation.radius * samples }, low, high);
    }
  }
  for (let index = 0; index < edited.rockinessDelta.length; index += 1) edited.rockinessDelta[index] -= 0.5;
  edited.sha256 = crypto.createHash("sha256").update(JSON.stringify({
    schema: "duskfell-edited-terrain-source-v1",
    baseSha256: source.sha256,
    operations,
    seamGuardTiles,
  })).digest("hex");
  edited.terrainAuthoring = {
    schema: "duskfell-source-terrain-authoring-v1",
    basePayloadSha256: source.sha256,
    editedSourceSha256: edited.sha256,
    operationCount: operations.length,
    seamGuardTiles,
  };
  return edited;
}

export function generateTerrainDiffusionWorld(recipe, source, generationOverride = null) {
  const { cols, rows, unitsPerTile } = recipe.dimensions;
  const samples = recipe.source.samplesPerTile;
  const apronSamples = recipe.macro.apronTiles * samples;
  if (source.width !== cols * samples + apronSamples * 2 + 1 || source.height !== rows * samples + apronSamples * 2 + 1) {
    throw new Error("Terrain Diffusion source dimensions do not match the recipe");
  }
  const elevationLow = source.normalization?.elevationLow ?? percentile(source.elevation, 0.06);
  const elevationHigh = source.normalization?.elevationHigh ?? percentile(source.elevation, 0.94);
  const seaLevel = source.normalization?.seaLevel ?? percentile(source.elevation, 0.055);
  const temperatureLow = source.normalization?.temperatureLow ?? percentile(source.climate[0], 0.04);
  const temperatureHigh = source.normalization?.temperatureHigh ?? percentile(source.climate[0], 0.96);
  const precipitationLow = source.normalization?.precipitationLow ?? percentile(source.climate[2], 0.04);
  const precipitationHigh = source.normalization?.precipitationHigh ?? percentile(source.climate[2], 0.96);
  const inheritedRiver = source.inheritedRiverChannel === 1 ? source.climate[1] : null;
  if (source.inheritedRiverChannel !== undefined && source.inheritedRiverChannel !== 1) throw new Error("terrain source inherited river channel is unsupported");
  if (inheritedRiver && ![...inheritedRiver].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error("terrain source inherited river potential is invalid");
  }
  const elevationSpan = Math.max(1e-9, elevationHigh - elevationLow);
  const normalizedSourceElevation = Float64Array.from(source.elevation, (value) => (value - elevationLow) / elevationSpan);
  let minimumElevation = Infinity;
  let maximumElevation = -Infinity;
  for (const value of normalizedSourceElevation) {
    minimumElevation = Math.min(minimumElevation, value);
    maximumElevation = Math.max(maximumElevation, value);
  }
  const sourceOrigin = erosionSourceOrigin(recipe, apronSamples);
  const erosion = erodeHeightfield(normalizedSourceElevation, source.width, source.height, {
    ...recipe.erosion,
    seed: source.erosionSeed ?? recipe.seed,
    originX: sourceOrigin.x,
    originY: sourceOrigin.y,
    bedrock: source.normalization ? 0 : minimumElevation,
    ceiling: source.normalization ? 1 : maximumElevation,
    seaLevel: (seaLevel - elevationLow) / elevationSpan,
  });
  const erodedElevation = Float64Array.from(erosion.elevation, (value) => elevationLow + value * elevationSpan);

  const heights = grid(rows + 1, cols + 1, (x, y) => {
    const raw = erodedElevation[(apronSamples + y * samples) * source.width + apronSamples + x * samples];
    return round(normalize(raw, elevationLow, elevationHigh), 5);
  });
  const tileElevation = grid(rows, cols, (x, y) => tileMean(erodedElevation, source.width, x, y, samples, apronSamples));
  const tileTemperature = grid(rows, cols, (x, y) => tileMean(source.climate[0], source.width, x, y, samples, apronSamples));
  const tilePrecipitation = grid(rows, cols, (x, y) => tileMean(source.climate[2], source.width, x, y, samples, apronSamples));
  const tileRockinessDelta = source.rockinessDelta
    ? grid(rows, cols, (x, y) => tileMean(source.rockinessDelta, source.width, x, y, samples, apronSamples))
    : grid(rows, cols, () => 0);
  const tileInheritedRiver = inheritedRiver
    ? grid(rows, cols, (x, y) => tileMean(inheritedRiver, source.width, x, y, samples, apronSamples))
    : grid(rows, cols, () => 0);
  const tileSea = grid(rows, cols, (x, y) => tileFraction(erodedElevation, null, source.width, x, y, samples, (elev) => elev <= seaLevel, apronSamples));
  const tileHeights = new Float64Array(cols * rows);
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    tileHeights[y * cols + x] = (heights[y][x] + heights[y][x + 1] + heights[y + 1][x] + heights[y + 1][x + 1]) * 0.25;
  }
  const hydrology = calculatePriorityFlood(tileHeights, cols, rows);
  const tileRiverThreshold = percentile(hydrology.accumulation, 0.975);
  const tileRiver = grid(rows, cols, (x, y) => {
    const tileAccumulation = hydrology.accumulation[y * cols + x];
    const local = smoothstep(tileRiverThreshold * 0.72, tileRiverThreshold * 1.15, tileAccumulation);
    const continental = smoothstep(0.65, 0.92, tileInheritedRiver[y][x]);
    return Math.max(local, continental);
  });
  const fields = Object.fromEntries(["temperature", "moisture", "rockiness", "snow", "soil", "disturbance", "vegetation", "water", "river", "lake", "slope"].map((name) => [name, grid(rows, cols, () => 0)]));
  const biomeWeights = Object.fromEntries(BIOMES.map((name) => [name, grid(rows, cols, () => 0)]));
  const materials = grid(rows, cols, () => "grass");

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const elevation = normalize(tileElevation[y][x], elevationLow, elevationHigh);
      const slope = tileSlope(heights, x, y);
      const temperature = normalize(tileTemperature[y][x], temperatureLow, temperatureHigh);
      const precipitation = normalize(tilePrecipitation[y][x], precipitationLow, precipitationHigh);
      const river = clamp(tileRiver[y][x] * 1.8);
      const sea = clamp(tileSea[y][x] * 1.35);
      const water = Math.max(river, sea);
      const moisture = clamp(precipitation * 0.72 + water * 0.28);
      const rockiness = clamp(slope * 0.82 + smoothstep(0.58, 0.9, elevation) * 0.7 + tileRockinessDelta[y][x]);
      const snow = clamp(smoothstep(recipe.terrain.snowline - 0.08, recipe.terrain.snowline + 0.04, elevation) * (1 - smoothstep(0.35, 0.62, temperature)));
      const soil = clamp(0.9 - rockiness * 0.74 + moisture * 0.12);
      const wetland = clamp((1 - water) * smoothstep(0.66, 0.92, moisture) * (1 - smoothstep(0.35, 0.62, elevation)));
      const meadow = clamp((1 - rockiness) * soil * (0.45 + moisture * 0.55) * (1 - wetland * 0.55));
      const loam = clamp((1 - rockiness * 0.74) * (0.95 - moisture * 0.5) * (0.7 + slope * 0.25));
      const weights = normalizeWeights({
        meadow: meadow * (1 - water),
        loam: loam * (1 - water),
        rock: rockiness * (1 - snow) * (1 - water),
        snow: snow * (1 - water),
        wetland: wetland * (1 - water),
        water,
      });
      const values = {
        temperature,
        moisture,
        rockiness,
        snow,
        soil,
        disturbance: 0,
        vegetation: clamp(meadow * 0.78 + wetland * 0.7),
        water,
        river,
        lake: sea,
        slope,
      };
      for (const [name, value] of Object.entries(values)) fields[name][y][x] = round(value);
      for (const biome of BIOMES) biomeWeights[biome][y][x] = weights[biome];
      materials[y][x] = dominantMaterial(weights);
    }
  }
  const authorityElevation = grid(rows * samples + 1, cols * samples + 1, (x, y) => round(
    normalize(erodedElevation[(y + apronSamples) * source.width + x + apronSamples], elevationLow, elevationHigh),
    5,
  ));
  const authorityPreErosionElevation = grid(rows * samples + 1, cols * samples + 1, (x, y) => round(
    normalize(source.elevation[(y + apronSamples) * source.width + x + apronSamples], elevationLow, elevationHigh),
    5,
  ));
  const authorityErosionDelta = grid(rows * samples + 1, cols * samples + 1, (x, y) => erosion.delta[(y + apronSamples) * source.width + x + apronSamples]);
  const contextCols = source.width - 1;
  const contextRows = source.height - 1;
  const authorityCellElevation = new Float64Array(contextCols * contextRows);
  for (let y = 0; y < contextRows; y += 1) for (let x = 0; x < contextCols; x += 1) {
    authorityCellElevation[y * contextCols + x] = erodedElevation[y * source.width + x];
  }
  const authorityHydrology = calculatePriorityFlood(authorityCellElevation, contextCols, contextRows);
  const authorityRiverThreshold = percentile(authorityHydrology.accumulation, 0.985);
  const authorityRiverEvidence = grid(contextRows, contextCols, (x, y) => Math.max(
    smoothstep(
      authorityRiverThreshold * 0.7,
      authorityRiverThreshold * 1.12,
      authorityHydrology.accumulation[y * contextCols + x],
    ),
    inheritedRiver ? smoothstep(0.65, 0.92, inheritedRiver[y * source.width + x]) : 0,
  ));
  const contextSea = grid(contextRows, contextCols, (x, y) => erodedElevation[y * source.width + x] <= seaLevel ? 1 : 0);
  const rawAuthorityCenterline = longestRiverPathInWindow(
    authorityRiverEvidence,
    contextSea,
    authorityHydrology.directions,
    contextCols,
    contextRows,
    { x: apronSamples, y: apronSamples, width: cols * samples, height: rows * samples },
  );
  const rawRiverCenterline = rawAuthorityCenterline.map((point) => ({ x: round(point.x / samples, 4), y: round(point.y / samples, 4) }));
  const riverCenterline = smoothPolyline(rawRiverCenterline, 4);
  const tributaries = extractTributaries({
    directions: hydrology.directions,
    accumulation: hydrology.accumulation,
    width: cols,
    height: rows,
    riverCenterline,
    maxTributaries: recipe.hydrology.maxTributaries,
    minimumTiles: recipe.hydrology.minTributaryLengthTiles,
  });
  const authoritySea = grid(rows * samples, cols * samples, (x, y) => contextSea[y + apronSamples][x + apronSamples]);
  const authorityWater = grid(rows * samples, cols * samples, (x, y) => {
    const sourceIndex = (y + apronSamples) * source.width + x + apronSamples;
    const sea = erodedElevation[sourceIndex] <= seaLevel ? 1 : 0;
    const river = Math.max(
      riverPressure(x / samples, y / samples, riverCenterline, recipe.terrain.riverWidth * 0.42),
      tributaryPressure(x / samples, y / samples, tributaries, recipe.terrain.riverWidth),
      inheritedRiver ? smoothstep(0.65, 0.92, inheritedRiver[(y + apronSamples) * source.width + x + apronSamples]) : 0,
    );
    return round(Math.max(sea, river));
  });
  const authorityRiver = grid(rows * samples, cols * samples, (x, y) => round(Math.max(
    riverPressure(x / samples, y / samples, riverCenterline, recipe.terrain.riverWidth * 0.42),
    tributaryPressure(x / samples, y / samples, tributaries, recipe.terrain.riverWidth),
    inheritedRiver ? smoothstep(0.65, 0.92, inheritedRiver[(y + apronSamples) * source.width + x + apronSamples]) : 0,
  )));
  const authoritySnow = grid(rows * samples, cols * samples, (x, y) => {
    const sourceIndex = (y + apronSamples) * source.width + x + apronSamples;
    const elevation = normalize(erodedElevation[sourceIndex], elevationLow, elevationHigh);
    const temperature = normalize(source.climate[0][sourceIndex], temperatureLow, temperatureHigh);
    return round(clamp(smoothstep(recipe.terrain.snowline - 0.08, recipe.terrain.snowline + 0.04, elevation) * (1 - smoothstep(0.35, 0.62, temperature))));
  });
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    const water = tileGridMean(authorityWater, x, y, samples);
    const river = tileGridMean(authorityRiver, x, y, samples);
    const lake = tileGridMean(authoritySea, x, y, samples);
    const snow = tileGridMean(authoritySnow, x, y, samples) * (1 - water);
    fields.water[y][x] = round(water);
    fields.river[y][x] = round(river);
    fields.lake[y][x] = round(lake);
    fields.snow[y][x] = round(snow);
    fields.moisture[y][x] = round(clamp(fields.moisture[y][x] * 0.72 + water * 0.28));
    const terrestrial = ["meadow", "loam", "rock", "wetland"];
    let terrestrialTotal = terrestrial.reduce((sum, biome) => sum + biomeWeights[biome][y][x], 0);
    if (terrestrialTotal <= 0.00001) {
      const rock = clamp(fields.rockiness[y][x]);
      const wetland = clamp((fields.moisture[y][x] - 0.72) * 1.8) * (1 - rock);
      biomeWeights.meadow[y][x] = (1 - rock) * (1 - wetland) * 0.62;
      biomeWeights.loam[y][x] = (1 - rock) * (1 - wetland) * 0.38;
      biomeWeights.rock[y][x] = rock;
      biomeWeights.wetland[y][x] = wetland;
      terrestrialTotal = terrestrial.reduce((sum, biome) => sum + biomeWeights[biome][y][x], 0) || 1;
    }
    const terrestrialBudget = Math.max(0, 1 - water - snow);
    for (const biome of terrestrial) biomeWeights[biome][y][x] = round(biomeWeights[biome][y][x] / terrestrialTotal * terrestrialBudget);
    biomeWeights.water[y][x] = round(water);
    biomeWeights.snow[y][x] = round(snow);
    materials[y][x] = dominantMaterial(Object.fromEntries(BIOMES.map((biome) => [biome, biomeWeights[biome][y][x]])));
  }
  const climate = deriveClimateAuthority({ dimensions: { cols, rows }, heights, fields, biomeWeights }, recipe);
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    materials[y][x] = dominantMaterial(Object.fromEntries(BIOMES.map((biome) => [biome, biomeWeights[biome][y][x]])));
  }
  addShores(materials, fields.water);
  const hydrologyAuthority = buildHydrologyAuthority({
    directions: hydrology.directions,
    accumulation: hydrology.accumulation,
    water: fields.water,
    lake: fields.lake,
    tributaries,
    watershedOutletBucketTiles: recipe.hydrology.watershedOutletBucketTiles,
    shorelineThreshold: recipe.hydrology.shorelineThreshold,
  });
  const authorityCellCols = cols * samples;
  const authorityCellRows = rows * samples;
  const waterDirections = cropFlat(authorityHydrology.directions, contextCols, apronSamples, apronSamples, authorityCellCols, authorityCellRows, Int8Array);
  const waterAccumulation = cropFlat(authorityHydrology.accumulation, contextCols, apronSamples, apronSamples, authorityCellCols, authorityCellRows, Float64Array);
  const waterFilledElevation = cropFlat(authorityHydrology.filled, contextCols, apronSamples, apronSamples, authorityCellCols, authorityCellRows, Float64Array);
  for (let index = 0; index < waterFilledElevation.length; index += 1) {
    waterFilledElevation[index] = normalize(waterFilledElevation[index], elevationLow, elevationHigh);
  }
  const waterAuthority = buildWaterAuthority({
    elevationVertices: authorityElevation,
    water: authorityWater,
    river: authorityRiver,
    lake: authoritySea,
    directions: waterDirections,
    filledElevation: waterFilledElevation,
    accumulation: waterAccumulation,
    samplesPerTile: samples,
    unitsPerTile,
  });
  const materialGrid = materials.map((row) => row.map((material) => MATERIALS.indexOf(material).toString(36)).join(""));
  const bundle = {
    schema: "duskfell-world-bundle-v2",
    version: "2.1.0",
    id: recipe.id,
    seed: recipe.seed,
    dimensions: { cols, rows, unitsPerTile, width: cols * unitsPerTile, height: rows * unitsPerTile },
    projection: "military-plan-oblique",
    sourceRecipe: "recipe.json",
    authority: {
      schema: "duskfell-terrain-authority-v1",
      samplesPerTile: samples,
      vertexCols: cols * samples + 1,
      vertexRows: rows * samples + 1,
      cellCols: cols * samples,
      cellRows: rows * samples,
      preErosionElevation: authorityPreErosionElevation,
      erosionDelta: authorityErosionDelta,
      elevation: authorityElevation,
      water: authorityWater,
      river: authorityRiver,
      snow: authoritySnow,
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
      rawRiverCenterline,
      riverCenterline,
      authority: hydrologyAuthority,
      authorityFlow: {
        cols: contextCols,
        rows: contextRows,
        apronSamples,
        accumulationThreshold: round(authorityRiverThreshold, 3),
        algorithm: "priority-flood-d8-v1",
        inheritedAtlasDrainage: inheritedRiver ? {
          channel: source.inheritedRiverChannel,
          corridorThreshold: 0.65,
          fullThreshold: 0.92,
        } : null,
      },
      sourceSeaLevelMeters: round(seaLevel, 2),
    },
    legacy: {
      cols,
      rows,
      materialGrid,
      heights: heights.map((row) => row.map((value) => round(value * 2, 3))),
      heathWeights: grid(rows + 1, cols + 1, (x, y) => round(biomeWeights.loam[Math.min(rows - 1, y)][Math.min(cols - 1, x)])),
      vegetation: fields.vegetation,
    },
    generation: {
      deterministic: true,
      algorithm: generationOverride?.algorithm ?? "terrain-diffusion-bridge-v1",
      palette: recipe.palette,
      erosion: erosion.metadata,
      terrainAuthoring: source.terrainAuthoring ?? { schema: "duskfell-source-terrain-authoring-v1", operationCount: 0 },
      source: generationOverride?.source ?? {
        repository: recipe.source.repository,
        model: recipe.source.model,
        region: recipe.source.region,
        scale: recipe.source.scale,
        samplesPerTile: samples,
        payloadSha256: source.sha256,
      },
    },
  };
  const weightedBundle = attachMaterialWeights(bundle);
  weightedBundle.contentSha256 = crypto.createHash("sha256").update(JSON.stringify(weightedBundle)).digest("hex");
  return weightedBundle;
}

function assertOperationInsideAtlasSeam(operation, recipe, guard) {
  const radius = operation.field === "riverSpline" ? Math.max(1, recipe.terrain.riverWidth * 0.5) : operation.radius;
  for (const point of operation.points) {
    if (
      point.x - radius < guard
      || point.y - radius < guard
      || point.x + radius > recipe.dimensions.cols - guard
      || point.y + radius > recipe.dimensions.rows - guard
    ) {
      throw new Error(`atlas terrain operation intersects the protected ${guard}-tile seam apron`);
    }
  }
}

function erosionSourceOrigin(recipe, apronSamples) {
  if (recipe.source.type === "atlas-region-v1") {
    return {
      x: recipe.source.region.x * recipe.dimensions.cols * recipe.source.samplesPerTile - apronSamples,
      y: recipe.source.region.y * recipe.dimensions.rows * recipe.source.samplesPerTile - apronSamples,
    };
  }
  return {
    x: recipe.source.region.j - apronSamples,
    y: recipe.source.region.i - apronSamples,
  };
}

function cropFlat(values, sourceWidth, x, y, width, height, ArrayType) {
  const cropped = new ArrayType(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) cropped[row * width + col] = values[(y + row) * sourceWidth + x + col];
  }
  return cropped;
}

function applySourceBrush(values, width, height, point, operation, low, high) {
  const source = operation.mode === "smooth" ? Float64Array.from(values) : null;
  const span = Math.max(1e-9, high - low);
  for (let y = Math.max(0, Math.floor(point.y - operation.radius)); y <= Math.min(height - 1, Math.ceil(point.y + operation.radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(point.x - operation.radius)); x <= Math.min(width - 1, Math.ceil(point.x + operation.radius)); x += 1) {
      const falloff = clamp(1 - Math.hypot(x - point.x, y - point.y) / operation.radius);
      if (falloff <= 0) continue;
      const index = y * width + x;
      const normalized = normalize(values[index], low, high);
      let next;
      if (operation.mode === "smooth") {
        let total = 0;
        let count = 0;
        for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          total += normalize(source[ny * width + nx], low, high);
          count += 1;
        }
        next = normalized + (total / count - normalized) * falloff * operation.strength;
      } else {
        next = normalized + operation.strength * falloff * (operation.mode === "lower" ? -1 : 1);
      }
      values[index] = low + clamp(next) * span;
    }
  }
}

function paintSourceRiverRoute(values, width, height, operation, recipe, apronSamples, samples) {
  const radius = Math.max(samples, recipe.terrain.riverWidth * samples * 0.5);
  const points = operation.points.map((point) => ({ x: apronSamples + point.x * samples, y: apronSamples + point.y * samples }));
  const segments = points.length > 1 ? points.slice(0, -1).map((point, index) => [point, points[index + 1]]) : [[points[0], points[0]]];
  for (const [from, to] of segments) {
    const minX = Math.max(0, Math.floor(Math.min(from.x, to.x) - radius));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(from.x, to.x) + radius));
    const minY = Math.max(0, Math.floor(Math.min(from.y, to.y) - radius));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(from.y, to.y) + radius));
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const distance = pointSegmentDistance(x, y, from, to);
      values[y * width + x] = Math.max(values[y * width + x], 1 - smoothstep(radius * 0.35, radius, distance));
    }
  }
}

function longestRiverPath(river, water, directions, cols, rows) {
  let longest = [];
  for (let start = 0; start < cols * rows; start += 1) {
    const sx = start % cols;
    const sy = Math.floor(start / cols);
    if (river[sy][sx] < 0.2) continue;
    const path = [];
    const seen = new Set();
    let index = start;
    while (!seen.has(index) && path.length < cols * rows) {
      seen.add(index);
      const x = index % cols;
      const y = Math.floor(index / cols);
      if (river[y][x] < 0.08 && water[y][x] < 0.35) break;
      path.push({ x: round(x + 0.5, 3), y: round(y + 0.5, 3) });
      const direction = directions[index];
      if (direction < 0) break;
      const [dx, dy] = D8[direction];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) break;
      index = ny * cols + nx;
    }
    if (path.length > longest.length) longest = path;
  }
  return longest;
}

function longestRiverPathInWindow(river, water, directions, cols, rows, window) {
  let longest = [];
  const xEnd = window.x + window.width;
  const yEnd = window.y + window.height;
  for (let sy = window.y; sy < yEnd; sy += 1) for (let sx = window.x; sx < xEnd; sx += 1) {
    if (river[sy][sx] < 0.2) continue;
    const path = [];
    const seen = new Set();
    let index = sy * cols + sx;
    while (!seen.has(index) && seen.size < cols * rows) {
      seen.add(index);
      const x = index % cols;
      const y = Math.floor(index / cols);
      const inside = x >= window.x && y >= window.y && x < xEnd && y < yEnd;
      if (inside) path.push({ x: round(x - window.x + 0.5, 3), y: round(y - window.y + 0.5, 3) });
      else if (path.length > 0) break;
      if (river[y][x] < 0.08 && water[y][x] < 0.35) break;
      const direction = directions[index];
      if (direction < 0) break;
      const [dx, dy] = D8[direction];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) break;
      index = ny * cols + nx;
    }
    if (path.length > longest.length) longest = path;
  }
  return longest;
}

function smoothPolyline(points, iterations) {
  const maximumPoints = 512;
  let result = points.length <= maximumPoints
    ? points.map((point) => ({ ...point }))
    : Array.from({ length: maximumPoints }, (_, index) => points[Math.round(index / (maximumPoints - 1) * (points.length - 1))]).map((point) => ({ ...point }));
  for (let iteration = 0; iteration < iterations && result.length >= 3; iteration += 1) {
    const next = [result[0]];
    for (let index = 1; index < result.length - 1; index += 1) {
      const before = result[index - 1];
      const point = result[index];
      const after = result[index + 1];
      next.push({
        x: round(before.x * 0.2 + point.x * 0.6 + after.x * 0.2, 4),
        y: round(before.y * 0.2 + point.y * 0.6 + after.y * 0.2, 4),
      });
    }
    next.push(result.at(-1));
    result = next;
  }
  return result;
}

function riverPressure(x, y, points, width) {
  if (points.length < 2) return 0;
  let distance = Infinity;
  for (let index = 0; index < points.length - 1; index += 1) {
    distance = Math.min(distance, pointSegmentDistance(x, y, points[index], points[index + 1]));
  }
  return 1 - smoothstep(width * 0.72, width * 1.32, distance);
}

function tributaryPressure(x, y, tributaries, riverWidth) {
  let pressure = 0;
  for (const tributary of tributaries) {
    const width = riverWidth * (0.16 + tributary.order * 0.055);
    pressure = Math.max(pressure, riverPressure(x, y, tributary.points, width));
  }
  return pressure;
}

function pointSegmentDistance(x, y, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? clamp(((x - a.x) * dx + (y - a.y) * dy) / lengthSquared) : 0;
  return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
}

function addShores(materials, water) {
  const rows = materials.length;
  const cols = materials[0].length;
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    if (materials[y][x] === "water") continue;
    if (D8.some(([dx, dy]) => water[y + dy]?.[x + dx] > 0.45)) materials[y][x] = "shore";
  }
}

function dominantMaterial(weights) {
  const key = BIOMES.reduce((winner, biome) => weights[biome] > weights[winner] ? biome : winner, BIOMES[0]);
  if (key === "meadow" || key === "wetland") return "grass";
  if (key === "loam") return "dirt";
  if (key === "snow") return "rock";
  return key;
}

function normalizeWeights(weights) {
  const total = Object.values(weights).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, round(Math.max(0, value) / total)]));
}

function tileMean(values, width, tileX, tileY, samples, offset = 0) {
  let total = 0;
  for (let y = 0; y < samples; y += 1) for (let x = 0; x < samples; x += 1) {
    total += values[(offset + tileY * samples + y) * width + offset + tileX * samples + x];
  }
  return total / (samples * samples);
}

function tileGridMean(values, tileX, tileY, samples) {
  let total = 0;
  for (let y = 0; y < samples; y += 1) for (let x = 0; x < samples; x += 1) {
    total += values[tileY * samples + y][tileX * samples + x];
  }
  return total / (samples * samples);
}

function tileFraction(primary, secondary, width, tileX, tileY, samples, predicate, offset = 0) {
  let total = 0;
  for (let y = 0; y < samples; y += 1) for (let x = 0; x < samples; x += 1) {
    const index = (offset + tileY * samples + y) * width + offset + tileX * samples + x;
    if (predicate(primary[index], secondary?.[index])) total += 1;
  }
  return total / (samples * samples);
}

function tileSlope(heights, x, y) {
  const dx = ((heights[y][x + 1] + heights[y + 1][x + 1]) - (heights[y][x] + heights[y + 1][x])) * 0.5;
  const dy = ((heights[y + 1][x] + heights[y + 1][x + 1]) - (heights[y][x] + heights[y][x + 1])) * 0.5;
  return clamp(Math.hypot(dx, dy) * 6.5);
}

function sampleGrid(field, x, y) {
  const rows = field.length;
  const cols = field[0].length;
  const x0 = Math.max(0, Math.min(cols - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(rows - 1, Math.floor(y)));
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const tx = clamp(x - x0);
  const ty = clamp(y - y0);
  return (field[y0][x0] * (1 - tx) + field[y0][x1] * tx) * (1 - ty) + (field[y1][x0] * (1 - tx) + field[y1][x1] * tx) * ty;
}

function percentile(values, fraction) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
}

function normalize(value, low, high) {
  return clamp((value - low) / Math.max(1e-9, high - low));
}

function matrix(values, cols, rows, map = (value) => value) {
  return Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => map(values[y * cols + x])));
}

function grid(rows, cols, fn) {
  return Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => fn(x, y)));
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(a, b, value) {
  const t = clamp((value - a) / Math.max(1e-9, b - a));
  return t * t * (3 - 2 * t);
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}
