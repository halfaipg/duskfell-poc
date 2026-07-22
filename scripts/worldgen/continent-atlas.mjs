import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { calculatePriorityFlood, D8 } from "./hydrology-authority.mjs";
import { erodeHeightfield } from "./erosion-authority.mjs";

export const ATLAS_RECIPE_SCHEMA = "duskfell-continent-atlas-recipe-v1";
export const ATLAS_SCHEMA = "duskfell-continent-atlas-v1";
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ZONES = new Set(["O", "I", "A", "T", "M", "R", "C", "B", "Q", "F", "G", "S", "H"]);

export function readAtlasRecipe(recipePath) {
  let recipe;
  try {
    recipe = JSON.parse(fs.readFileSync(path.resolve(recipePath), "utf8"));
  } catch (error) {
    throw new Error(`unable to read continent atlas recipe: ${error.message}`);
  }
  return validateAtlasRecipe(recipe);
}

export function validateAtlasRecipe(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("continent atlas recipe must be an object");
  if (input.schema !== ATLAS_RECIPE_SCHEMA) throw new Error(`continent atlas recipe schema must be ${ATLAS_RECIPE_SCHEMA}`);
  if (!SAFE_ID.test(input.id ?? "")) throw new Error("continent atlas id must be lowercase kebab-case");
  integer(input.seed, "seed", 0, 0x7fffffff);
  const dimensions = object(input.dimensions, "dimensions");
  integer(dimensions.regionCols, "dimensions.regionCols", 2, 128);
  integer(dimensions.regionRows, "dimensions.regionRows", 2, 128);
  const regionTiles = object(dimensions.regionTiles, "dimensions.regionTiles");
  integer(regionTiles.cols, "dimensions.regionTiles.cols", 32, 512);
  integer(regionTiles.rows, "dimensions.regionTiles.rows", 32, 512);
  integer(dimensions.unitsPerTile, "dimensions.unitsPerTile", 64, 64);
  const sampling = object(input.sampling, "sampling");
  integer(sampling.samplesPerRegion, "sampling.samplesPerRegion", 2, 16);
  const chunks = object(input.chunks, "chunks");
  integer(chunks.tiles, "chunks.tiles", 8, 128);
  integer(chunks.apronTiles, "chunks.apronTiles", 1, 32);
  if (regionTiles.cols % chunks.tiles !== 0 || regionTiles.rows % chunks.tiles !== 0) {
    throw new Error("region tile dimensions must be divisible by chunks.tiles");
  }
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
  const climate = object(input.climate, "climate");
  finite(climate.latitudeSouthDegrees, "climate.latitudeSouthDegrees", -70, 70);
  finite(climate.latitudeNorthDegrees, "climate.latitudeNorthDegrees", -70, 70);
  if (climate.latitudeNorthDegrees <= climate.latitudeSouthDegrees) throw new Error("atlas latitude range must run south to north");
  if (climate.prevailingWind !== "west-to-east") throw new Error("atlas prevailing wind currently supports west-to-east");
  finite(climate.seaLevel, "climate.seaLevel", 0.15, 0.75);
  finite(climate.elevationLapse, "climate.elevationLapse", 0.1, 1);
  finite(climate.orographicLift, "climate.orographicLift", 0.1, 3);
  const source = object(input.source, "source");
  if (source.type !== "synthetic-atlas-v1" || source.model !== "duskfell-atlas-fbm-v1") {
    throw new Error("continent atlas source must be synthetic-atlas-v1 using duskfell-atlas-fbm-v1");
  }
  nonempty(source.repository, "source.repository");
  nonempty(source.license, "source.license");
  const seasonality = object(input.seasonality, "seasonality");
  integer(seasonality.calendarDays, "seasonality.calendarDays", 120, 2000);
  if (!Array.isArray(seasonality.seasons) || seasonality.seasons.length !== 4) throw new Error("atlas seasonality must declare four seasons");
  if (!new Set(seasonality.seasons).size || !["spring", "summer", "autumn", "winter"].every((id) => seasonality.seasons.includes(id))) {
    throw new Error("atlas seasons must include spring, summer, autumn, and winter");
  }
  const review = object(input.review, "review");
  integer(review.maxLongEdge, "review.maxLongEdge", 512, 2048);
  return structuredClone(input);
}

export function generateContinentAtlas(recipeInput) {
  const recipe = validateAtlasRecipe(recipeInput);
  const sampleCols = recipe.dimensions.regionCols * recipe.sampling.samplesPerRegion;
  const sampleRows = recipe.dimensions.regionRows * recipe.sampling.samplesPerRegion;
  let elevation = grid(sampleRows, sampleCols, 0);
  const temperature = grid(sampleRows, sampleCols, 0);
  const precipitation = grid(sampleRows, sampleCols, 0);
  const humidity = grid(sampleRows, sampleCols, 0);
  const windExposure = grid(sampleRows, sampleCols, 0);

  for (let y = 0; y < sampleRows; y += 1) for (let x = 0; x < sampleCols; x += 1) {
    elevation[y][x] = round(atlasElevation(x, y, sampleCols, sampleRows, recipe.seed));
  }
  const preErosionElevation = elevation.map((row) => [...row]);
  const erosion = erodeHeightfield(Float64Array.from(elevation.flat()), sampleCols, sampleRows, {
    ...recipe.erosion,
    seed: recipe.seed,
    seaLevel: recipe.climate.seaLevel,
  });
  elevation = matrix(erosion.elevation, sampleCols, sampleRows);
  const waterDistance = distanceField(elevation, (value) => value <= recipe.climate.seaLevel);
  for (let y = 0; y < sampleRows; y += 1) {
    let westBarrier = 0;
    for (let x = 0; x < sampleCols; x += 1) {
      const height = elevation[y][x];
      const previousHeight = elevation[y][Math.max(0, x - 1)];
      const rise = Math.max(0, height - previousHeight);
      const latitude = sampleRows === 1 ? 0.5 : y / (sampleRows - 1);
      const latitudeDegrees = lerp(recipe.climate.latitudeNorthDegrees, recipe.climate.latitudeSouthDegrees, latitude);
      const latitudeCooling = Math.abs(latitudeDegrees) / 90;
      const water = height <= recipe.climate.seaLevel;
      const coastalHumidity = Math.exp(-waterDistance[y][x] / Math.max(2, recipe.sampling.samplesPerRegion * 2.5));
      const normalizedLand = clamp((height - recipe.climate.seaLevel) / Math.max(0.01, 1 - recipe.climate.seaLevel));
      westBarrier = Math.max(westBarrier * 0.965, normalizedLand);
      const rainShadow = Math.max(0, westBarrier - normalizedLand) * 0.34;
      const rainNoise = fbm(x * 0.105, y * 0.105, recipe.seed + 701);
      const rain = clamp(0.19 + coastalHumidity * 0.43 + rainNoise * 0.25 + rise * recipe.climate.orographicLift - rainShadow);
      temperature[y][x] = round(clamp(0.94 - latitudeCooling * 0.78 - normalizedLand * recipe.climate.elevationLapse));
      precipitation[y][x] = round(water ? clamp(0.7 + rainNoise * 0.18) : rain);
      humidity[y][x] = round(clamp(rain * 0.56 + coastalHumidity * 0.38 + (water ? 0.24 : 0)));
      windExposure[y][x] = round(clamp(0.2 + normalizedLand * 0.62 + rise * 1.4 - coastalHumidity * 0.08));
    }
  }
  const drainage = buildAtlasDrainage(elevation, precipitation, recipe.climate.seaLevel, {
    cols: recipe.dimensions.regionCols * recipe.dimensions.regionTiles.cols,
    rows: recipe.dimensions.regionRows * recipe.dimensions.regionTiles.rows,
  });
  const zoneRows = Array.from({ length: sampleRows }, (_, y) => Array.from({ length: sampleCols }, (_, x) => climateZone({
    elevation: elevation[y][x],
    temperature: temperature[y][x],
    precipitation: precipitation[y][x],
    humidity: humidity[y][x],
    waterDistance: waterDistance[y][x],
    seaLevel: recipe.climate.seaLevel,
  })).join(""));
  const atlas = {
    schema: ATLAS_SCHEMA,
    id: recipe.id,
    seed: recipe.seed,
    dimensions: {
      ...recipe.dimensions,
      worldTiles: {
        cols: recipe.dimensions.regionCols * recipe.dimensions.regionTiles.cols,
        rows: recipe.dimensions.regionRows * recipe.dimensions.regionTiles.rows,
      },
      worldUnits: {
        width: recipe.dimensions.regionCols * recipe.dimensions.regionTiles.cols * recipe.dimensions.unitsPerTile,
        height: recipe.dimensions.regionRows * recipe.dimensions.regionTiles.rows * recipe.dimensions.unitsPerTile,
      },
    },
    sampling: { ...recipe.sampling, cols: sampleCols, rows: sampleRows },
    chunks: {
      ...recipe.chunks,
      perRegion: {
        cols: recipe.dimensions.regionTiles.cols / recipe.chunks.tiles,
        rows: recipe.dimensions.regionTiles.rows / recipe.chunks.tiles,
        count: recipe.dimensions.regionTiles.cols / recipe.chunks.tiles * (recipe.dimensions.regionTiles.rows / recipe.chunks.tiles),
      },
    },
    climate: {
      ...recipe.climate,
      seasonality: recipe.seasonality,
      dynamicWeatherStatus: "regional weather fronts not implemented",
    },
    source: recipe.source,
    fields: {
      preErosionElevation,
      erosionDelta: matrix(erosion.delta, sampleCols, sampleRows),
      elevation,
      temperature,
      precipitation,
      humidity,
      windExposure,
      riverPotential: drainage.riverPotential,
    },
    erosion: erosion.metadata,
    drainage: drainage.authority,
    climateZones: { legend: zoneLegend(), rows: zoneRows },
  };
  atlas.contentSha256 = hashJson(atlas);
  return atlas;
}

export function buildRegionIndex(atlas) {
  const regions = [];
  const { regionCols, regionRows, regionTiles } = atlas.dimensions;
  const samples = atlas.sampling.samplesPerRegion;
  for (let y = 0; y < regionRows; y += 1) for (let x = 0; x < regionCols; x += 1) {
    const id = `${atlas.id}-r${x}-${y}`;
    const parentSample = { x: x * samples, y: y * samples, cols: samples, rows: samples };
    const authority = sliceAuthority(atlas, parentSample);
    const descriptor = {
      id,
      coord: { x, y },
      tileOrigin: { x: x * regionTiles.cols, y: y * regionTiles.rows },
      dimensions: { cols: regionTiles.cols, rows: regionTiles.rows, unitsPerTile: atlas.dimensions.unitsPerTile },
      parentSample,
      parentAuthoritySha256: hashJson(authority),
      seed: regionSeed(atlas.seed, x, y),
      chunkGrid: atlas.chunks.perRegion,
      neighbors: {
        north: y > 0 ? `${atlas.id}-r${x}-${y - 1}` : null,
        east: x + 1 < regionCols ? `${atlas.id}-r${x + 1}-${y}` : null,
        south: y + 1 < regionRows ? `${atlas.id}-r${x}-${y + 1}` : null,
        west: x > 0 ? `${atlas.id}-r${x - 1}-${y}` : null,
      },
      drainageGates: regionDrainageGates(atlas, x, y),
      climateSummary: summarizeAuthority(authority),
      generationState: "unbuilt",
    };
    descriptor.descriptorSha256 = hashJson(descriptor);
    regions.push(descriptor);
  }
  return {
    schema: "duskfell-continent-region-index-v1",
    atlas: atlas.id,
    atlasContentSha256: atlas.contentSha256,
    regionCount: regions.length,
    totalGameplayChunks: regions.length * atlas.chunks.perRegion.count,
    addressing: "region coordinates are absolute; region refinement must bind to parentAuthoritySha256",
    regions,
  };
}

export function writeAtlasPackage(recipeInput, outputDir) {
  const recipe = validateAtlasRecipe(recipeInput);
  const root = path.resolve(outputDir);
  fs.mkdirSync(root, { recursive: true });
  const atlas = generateContinentAtlas(recipe);
  const regionIndex = buildRegionIndex(atlas);
  const recipePath = path.join(root, "recipe.json");
  const atlasPath = path.join(root, "atlas.json");
  const regionDir = path.join(root, "regions");
  const regionIndexPath = path.join(regionDir, "index.json");
  fs.mkdirSync(regionDir, { recursive: true });
  fs.writeFileSync(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);
  fs.writeFileSync(atlasPath, `${JSON.stringify(atlas)}\n`);
  fs.writeFileSync(regionIndexPath, `${JSON.stringify(regionIndex)}\n`);
  const rasters = renderAtlasReview(atlas, recipe, root);
  const manifest = {
    schema: "duskfell-continent-atlas-manifest-v1",
    state: "review",
    atlas: atlas.id,
    recipe: { path: "recipe.json", sha256: sha256(recipePath) },
    authority: { path: "atlas.json", sha256: sha256(atlasPath), contentSha256: atlas.contentSha256 },
    regionIndex: { path: "regions/index.json", sha256: sha256(regionIndexPath), count: regionIndex.regionCount },
    rasters,
    runtimeStatus: "atlas drainage and atlas-bound region refinement implemented; runtime chunk paging not implemented",
  };
  const manifestPath = path.join(root, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { atlas, regionIndex, manifest, manifestPath };
}

function renderAtlasReview(atlas, recipe, root) {
  const aspect = atlas.sampling.cols / atlas.sampling.rows;
  const width = aspect >= 1 ? recipe.review.maxLongEdge : Math.max(256, Math.round(recipe.review.maxLongEdge * aspect));
  const height = aspect >= 1 ? Math.max(256, Math.round(recipe.review.maxLongEdge / aspect)) : recipe.review.maxLongEdge;
  const definitions = [
    ["elevation", atlas.fields.elevation, [[24, 47, 58], [196, 188, 154]]],
    ["temperature", atlas.fields.temperature, [[47, 78, 112], [194, 102, 54]]],
    ["precipitation", atlas.fields.precipitation, [[112, 83, 54], [51, 133, 153]]],
    ["humidity", atlas.fields.humidity, [[102, 78, 51], [45, 139, 145]]],
    ["river-potential", atlas.fields.riverPotential, [[28, 31, 32], [59, 171, 210]]],
  ];
  const rasters = {};
  for (const [name, field, ramp] of definitions) {
    const ppm = path.join(root, `.${name}.ppm`);
    const output = path.join(root, `${name}.png`);
    writeFieldPpm(field, ppm, ramp);
    execFileSync("magick", [ppm, "-filter", "Cubic", "-resize", `${width}x${height}!`, "-define", "png:compression-level=9", output]);
    fs.unlinkSync(ppm);
    rasters[name] = { path: path.basename(output), width, height, sha256: sha256(output) };
  }
  const zonePpm = path.join(root, ".climate-zones.ppm");
  const zoneOutput = path.join(root, "climate-zones.png");
  writeZonePpm(atlas.climateZones.rows, zonePpm);
  execFileSync("magick", [zonePpm, "-filter", "Point", "-resize", `${width}x${height}!`, "-define", "png:compression-level=9", zoneOutput]);
  fs.unlinkSync(zonePpm);
  rasters.climateZones = { path: path.basename(zoneOutput), width, height, sha256: sha256(zoneOutput) };
  const reviewSheet = path.join(root, "review-sheet.png");
  execFileSync("magick", [
    "montage",
    ...Object.values(rasters).map((entry) => path.join(root, entry.path)),
    "-thumbnail", "512x512",
    "-tile", "3x2",
    "-geometry", "+12+12",
    "-background", "#111111",
    reviewSheet,
  ]);
  rasters.reviewSheet = { path: "review-sheet.png", sha256: sha256(reviewSheet) };
  return rasters;
}

function atlasElevation(x, y, cols, rows, seed) {
  const nx = cols <= 1 ? 0 : x / (cols - 1) * 2 - 1;
  const ny = rows <= 1 ? 0 : y / (rows - 1) * 2 - 1;
  const warpX = (fbm(x * 0.045, y * 0.045, seed + 17) - 0.5) * 18;
  const warpY = (fbm(x * 0.045, y * 0.045, seed + 29) - 0.5) * 18;
  const continental = fbm((x + warpX) * 0.034, (y + warpY) * 0.034, seed + 101);
  const regional = fbm((x - warpY) * 0.093, (y + warpX) * 0.093, seed + 307);
  const ridgeNoise = Math.abs(fbm(x * 0.071, y * 0.071, seed + 911) * 2 - 1);
  const ridge = 1 - ridgeNoise;
  const coastWarpX = (continental - 0.5) * 0.34;
  const coastWarpY = (regional - 0.5) * 0.25;
  const main = landEnvelope(nx + coastWarpX, ny + coastWarpY, -0.2, -0.04, 0.72, 0.82, -0.18);
  const east = landEnvelope(nx - coastWarpX * 0.35, ny + coastWarpY, 0.46, -0.12, 0.48, 0.5, 0.32);
  const south = landEnvelope(nx + coastWarpX * 0.5, ny - coastWarpY * 0.4, 0.08, 0.62, 0.34, 0.25, -0.08);
  const envelope = Math.max(main, east * 0.94, south * 0.86);
  const mountainCenterY = -0.34 + (nx + 1) * 0.24 + Math.sin((nx + 0.35) * Math.PI * 1.4) * 0.08;
  const mountainBelt = Math.exp(-Math.pow((ny - mountainCenterY) / 0.13, 2)) * envelope;
  const mountainLift = mountainBelt * (0.08 + ridge * ridge * 0.32);
  return clamp(envelope * (0.34 + continental * 0.42 + regional * 0.16 + ridge * 0.15) + mountainLift - 0.08);
}

function landEnvelope(x, y, centerX, centerY, radiusX, radiusY, rotation) {
  const dx = x - centerX;
  const dy = y - centerY;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const rx = (dx * cosine - dy * sine) / radiusX;
  const ry = (dx * sine + dy * cosine) / radiusY;
  const distance = Math.sqrt(rx * rx + ry * ry);
  return 1 - smoothstep(0.72, 1.08, distance);
}

function climateZone({ elevation, temperature, precipitation, humidity, waterDistance, seaLevel }) {
  if (elevation <= seaLevel) return "O";
  if (temperature < 0.055 && elevation > 0.97) return "I";
  if (elevation > 0.84) return elevation > 0.93 || temperature < 0.1 ? "A" : "C";
  if (temperature < 0.25) return "T";
  if (waterDistance <= 1 && humidity > 0.7) return "R";
  if (humidity > 0.82 && elevation < 0.62) return "M";
  if (precipitation > 0.75 && temperature > 0.34) return "Q";
  if (precipitation > 0.57) return temperature < 0.46 ? "B" : "F";
  if (precipitation < 0.3) return "S";
  if (humidity < 0.48 && elevation > 0.55) return "H";
  return "G";
}

function sliceAuthority(atlas, bounds) {
  return {
    elevation: sliceGrid(atlas.fields.elevation, bounds),
    temperature: sliceGrid(atlas.fields.temperature, bounds),
    precipitation: sliceGrid(atlas.fields.precipitation, bounds),
    humidity: sliceGrid(atlas.fields.humidity, bounds),
    windExposure: sliceGrid(atlas.fields.windExposure, bounds),
    riverPotential: sliceGrid(atlas.fields.riverPotential, bounds),
    climateZones: atlas.climateZones.rows.slice(bounds.y, bounds.y + bounds.rows).map((row) => row.slice(bounds.x, bounds.x + bounds.cols)),
  };
}

function buildAtlasDrainage(elevation, precipitation, seaLevel, worldTiles) {
  const rows = elevation.length;
  const cols = elevation[0].length;
  const heights = Float64Array.from(elevation.flat());
  const flood = calculatePriorityFlood(heights, cols, rows);
  const runoff = Float64Array.from(heights, (height, index) => height > seaLevel ? 0.18 + precipitation[Math.floor(index / cols)][index % cols] * 0.82 : 0);
  const order = Array.from({ length: runoff.length }, (_, index) => index).sort((a, b) => flood.filled[b] - flood.filled[a] || b - a);
  for (const index of order) {
    const direction = flood.directions[index];
    if (direction < 0) continue;
    const x = index % cols;
    const y = Math.floor(index / cols);
    const [dx, dy] = D8[direction];
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) runoff[ny * cols + nx] += runoff[index];
  }
  const landRunoff = [...runoff].filter((_, index) => heights[index] > seaLevel);
  const threshold = percentile(landRunoff, 0.91);
  const full = Math.max(threshold + 1e-6, percentile(landRunoff, 0.992));
  const riverPotential = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => {
    const index = y * cols + x;
    if (heights[index] <= seaLevel) return 0;
    return round(smoothstep(Math.log1p(threshold), Math.log1p(full), Math.log1p(runoff[index])));
  }));
  const gateThreshold = 0.65;
  const riverSegments = [];
  const pointFor = (index) => ({
    x: index % cols / (cols - 1) * worldTiles.cols,
    y: Math.floor(index / cols) / (rows - 1) * worldTiles.rows,
  });
  const downstreamFor = (index) => {
    const direction = flood.directions[index];
    if (direction < 0) return -1;
    const x = index % cols;
    const y = Math.floor(index / cols);
    const [dx, dy] = D8[direction];
    const nx = x + dx;
    const ny = y + dy;
    return nx < 0 || ny < 0 || nx >= cols || ny >= rows ? -1 : ny * cols + nx;
  };
  const tangentFor = (index) => {
    const point = pointFor(index);
    const downstream = downstreamFor(index);
    const outgoing = downstream >= 0 ? unitVector(point, pointFor(downstream)) : null;
    const x = index % cols;
    const y = Math.floor(index / cols);
    const upstream = D8.map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
      .filter((candidate) => candidate.x >= 0 && candidate.y >= 0 && candidate.x < cols && candidate.y < rows)
      .map((candidate) => candidate.y * cols + candidate.x)
      .filter((candidate) => downstreamFor(candidate) === index)
      .sort((left, right) => runoff[right] - runoff[left] || left - right)[0];
    const incoming = upstream === undefined ? null : unitVector(pointFor(upstream), point);
    if (!incoming) return outgoing ?? { x: 0, y: 1 };
    if (!outgoing) return incoming;
    const length = Math.hypot(incoming.x + outgoing.x, incoming.y + outgoing.y);
    return length > 1e-6 ? { x: (incoming.x + outgoing.x) / length, y: (incoming.y + outgoing.y) / length } : outgoing;
  };
  for (let index = 0; index < heights.length; index += 1) {
    const x = index % cols;
    const y = Math.floor(index / cols);
    const potential = riverPotential[y][x];
    const direction = flood.directions[index];
    if (potential < gateThreshold || direction < 0) continue;
    const [dx, dy] = D8[direction];
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const downstream = ny * cols + nx;
    const from = pointFor(index);
    const to = pointFor(downstream);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const startTangent = tangentFor(index);
    const endTangent = tangentFor(downstream);
    const handle = distance * 0.32;
    const controlA = { x: from.x + startTangent.x * handle, y: from.y + startTangent.y * handle };
    const controlB = { x: to.x - endTangent.x * handle, y: to.y - endTangent.y * handle };
    const points = Array.from({ length: 9 }, (_, pointIndex) => cubicBezier(from, controlA, controlB, to, pointIndex / 8));
    riverSegments.push({
      id: `river-segment-${index}`,
      from: roundPoint(from),
      to: roundPoint(to),
      points: points.map(roundPoint),
      potential,
      widthTiles: round(1.75 + potential * 2.75),
    });
  }
  let outlets = 0;
  for (let index = 0; index < heights.length; index += 1) {
    if (heights[index] <= seaLevel) continue;
    const direction = flood.directions[index];
    if (direction < 0) {
      outlets += 1;
      continue;
    }
    const x = index % cols;
    const y = Math.floor(index / cols);
    const [dx, dy] = D8[direction];
    const next = (y + dy) * cols + x + dx;
    if (heights[next] <= seaLevel) outlets += 1;
  }
  return {
    riverPotential,
    authority: {
      schema: "duskfell-continent-drainage-v1",
      algorithm: "priority-flood-d8-precipitation-runoff-v1",
      cols,
      rows,
      seaLevel,
      runoffThreshold: round(threshold),
      runoffFull: round(full),
      gateThreshold,
      outlets,
      riverSegments,
      flowDirectionD8: matrix(flood.directions, cols, rows),
      flowAccumulation: matrix(runoff, cols, rows, (value) => round(value)),
    },
  };
}

function regionDrainageGates(atlas, regionX, regionY) {
  const definitions = {
    north: { orientation: "h", boundary: regionY, span: regionX },
    east: { orientation: "v", boundary: regionX + 1, span: regionY },
    south: { orientation: "h", boundary: regionY + 1, span: regionX },
    west: { orientation: "v", boundary: regionX, span: regionY },
  };
  const result = { threshold: atlas.drainage.gateThreshold };
  for (const [side, definition] of Object.entries(definitions)) {
    const boundary = definition.boundary * (definition.orientation === "v" ? atlas.dimensions.regionTiles.cols : atlas.dimensions.regionTiles.rows);
    const spanStart = definition.span * (definition.orientation === "v" ? atlas.dimensions.regionTiles.rows : atlas.dimensions.regionTiles.cols);
    const spanSize = definition.orientation === "v" ? atlas.dimensions.regionTiles.rows : atlas.dimensions.regionTiles.cols;
    const gates = atlas.drainage.riverSegments.flatMap((segment) => {
      const crossings = [];
      for (let pointIndex = 0; pointIndex < segment.points.length - 1; pointIndex += 1) {
        const from = segment.points[pointIndex];
        const to = segment.points[pointIndex + 1];
        const primaryFrom = definition.orientation === "v" ? from.x : from.y;
        const primaryTo = definition.orientation === "v" ? to.x : to.y;
        const delta = primaryTo - primaryFrom;
        if (Math.abs(delta) < 1e-9) continue;
        const amount = (boundary - primaryFrom) / delta;
        if (amount < -1e-9 || amount > 1 + 1e-9) continue;
        const secondaryFrom = definition.orientation === "v" ? from.y : from.x;
        const secondaryTo = definition.orientation === "v" ? to.y : to.x;
        const crossing = lerp(secondaryFrom, secondaryTo, clamp(amount));
        const offset = (crossing - spanStart) / spanSize;
        if (offset < -1e-9 || offset > 1 + 1e-9) continue;
        crossings.push({
          id: `${definition.orientation}:${definition.boundary}:${definition.span}:${segment.id}:${pointIndex}`,
          offset: round(clamp(offset)),
          potential: segment.potential,
          width: round(Math.min(0.125, segment.widthTiles / spanSize)),
        });
      }
      return crossings;
    }).sort((left, right) => left.offset - right.offset || left.id.localeCompare(right.id));
    result[side] = gates.filter((gate, index) => index === 0 || Math.abs(gate.offset - gates[index - 1].offset) > 0.0001 || gate.potential !== gates[index - 1].potential);
  }
  return result;
}

function summarizeAuthority(authority) {
  const values = Object.fromEntries(Object.entries(authority).filter(([name]) => name !== "climateZones").map(([name, rows]) => {
    const flat = rows.flat();
    return [name, { min: round(Math.min(...flat)), max: round(Math.max(...flat)), mean: round(flat.reduce((sum, value) => sum + value, 0) / flat.length) }];
  }));
  const counts = new Map();
  for (const code of authority.climateZones.join("")) counts.set(code, (counts.get(code) ?? 0) + 1);
  const dominantZone = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "O";
  return { ...values, dominantZone };
}

function regionSeed(seed, x, y) {
  return crypto.createHash("sha256").update(`${seed}:region-v1:${x}:${y}`).digest().readUInt32BE(0) & 0x7fffffff;
}

function distanceField(values, predicate) {
  const rows = values.length;
  const cols = values[0].length;
  const result = grid(rows, cols, Number.POSITIVE_INFINITY);
  const queue = [];
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) if (predicate(values[y][x])) {
    result[y][x] = 0;
    queue.push({ x, y });
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = current.x + dx;
      const y = current.y + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows || result[y][x] <= result[current.y][current.x] + 1) continue;
      result[y][x] = result[current.y][current.x] + 1;
      queue.push({ x, y });
    }
  }
  return result;
}

function writeFieldPpm(field, outputPath, ramp) {
  const rows = field.length;
  const cols = field[0].length;
  const bytes = Buffer.alloc(cols * rows * 3);
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    for (let channel = 0; channel < 3; channel += 1) bytes[(y * cols + x) * 3 + channel] = Math.round(lerp(ramp[0][channel], ramp[1][channel], field[y][x]));
  }
  fs.writeFileSync(outputPath, Buffer.concat([Buffer.from(`P6\n${cols} ${rows}\n255\n`), bytes]));
}

function writeZonePpm(rows, outputPath) {
  const palette = {
    O: [40, 91, 111], I: [226, 231, 228], A: [169, 174, 166], T: [132, 145, 119],
    M: [62, 91, 72], R: [73, 117, 83], C: [108, 105, 101], B: [66, 91, 66],
    Q: [50, 104, 67], F: [76, 116, 68], G: [119, 139, 78], S: [151, 125, 82], H: [109, 101, 77],
  };
  const height = rows.length;
  const width = rows[0].length;
  const bytes = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const color = palette[rows[y][x]];
    for (let channel = 0; channel < 3; channel += 1) bytes[(y * width + x) * 3 + channel] = color[channel];
  }
  fs.writeFileSync(outputPath, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), bytes]));
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

function zoneLegend() {
  return { O: "open-water", I: "permanent-snow", A: "alpine", T: "tundra", M: "marsh", R: "riparian", C: "crag", B: "boreal-woodland", Q: "temperate-rainforest", F: "temperate-woodland", G: "grassland", S: "dry-scrub", H: "heath" };
}

function sliceGrid(values, bounds) {
  return values.slice(bounds.y, bounds.y + bounds.rows).map((row) => row.slice(bounds.x, bounds.x + bounds.cols));
}

function percentile(values, fraction) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
}

function matrix(values, cols, rows, map = (value) => value) {
  return Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => map(values[y * cols + x])));
}

function cubicBezier(from, controlA, controlB, to, amount) {
  const inverse = 1 - amount;
  return {
    x: inverse ** 3 * from.x + 3 * inverse ** 2 * amount * controlA.x + 3 * inverse * amount ** 2 * controlB.x + amount ** 3 * to.x,
    y: inverse ** 3 * from.y + 3 * inverse ** 2 * amount * controlA.y + 3 * inverse * amount ** 2 * controlB.y + amount ** 3 * to.y,
  };
}

function unitVector(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function roundPoint(point) {
  return { x: round(point.x), y: round(point.y) };
}

function grid(rows, cols, value) {
  return Array.from({ length: rows }, () => Array(cols).fill(value));
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function smoothstep(a, b, value) {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Number(value.toFixed(4));
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer between ${min} and ${max}`);
}

function finite(value, label, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}`);
}

function nonempty(value, label) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2000) throw new Error(`${label} must be a non-empty bounded string`);
}

export function isKnownAtlasZone(code) {
  return ZONES.has(code);
}
