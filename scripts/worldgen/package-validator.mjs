import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { readRecipe } from "./recipe.mjs";
import { cropRgb, readRgbImages } from "./chunk-visuals.mjs";
import { validateWorldAuthoringPatch } from "../../client/world-editor-authoring.js";
import { MATERIAL_WEIGHT_FAMILIES } from "./material-weights.mjs";

const BIOMES = ["meadow", "loam", "rock", "snow", "wetland", "water"];
const FIELDS = ["temperature", "precipitation", "moisture", "humidity", "fogPotential", "windExposure", "growingSeason", "rockiness", "snow", "soil", "disturbance", "vegetation", "water", "river", "lake", "slope", "settlement", "trail"];
const HABITAT_CODES = new Set(["W", "I", "A", "T", "M", "R", "C", "B", "Q", "F", "G", "S", "H"]);
const RESOURCE_KINDS = new Set(["Wood", "Ore", "Stone", "Charge", "Deadwood", "Fiber", "Mycelium", "Spores", "Seed"]);
const LIFECYCLE_FAMILIES = new Set(["tree", "deadwood", "mineral", "mycelium", "machine"]);
const LANDMARK_TYPES = new Set(["ancient-ruin", "sacred-grove", "mineral-scar", "waystone"]);

export function validateWorldPackage(packageDir, { writeReport = true } = {}) {
  const root = path.resolve(packageDir);
  const failures = [];
  const recipe = readRecipe(path.join(root, "recipe.json"));
  const bundle = readJson(root, "world-bundle-v2.json", failures);
  const patch = readJson(root, "server-authority-patch.json", failures);
  const manifest = readJson(root, "manifest.json", failures);
  if (!bundle || !patch || !manifest) return finish(root, recipe, failures, {}, writeReport);
  const terrainDetailPatch = readJson(root, "terrain-detail-authority-patch.json", failures);

  check(bundle.schema === "duskfell-world-bundle-v2", "bundle schema is not v2", failures);
  check(bundle.id === recipe.id, "bundle world id does not match recipe", failures);
  const unhashedBundle = structuredClone(bundle);
  delete unhashedBundle.contentSha256;
  const computedContentHash = crypto.createHash("sha256").update(JSON.stringify(unhashedBundle)).digest("hex");
  check(bundle.contentSha256 === computedContentHash, "bundle deterministic content hash does not match its contents", failures);
  check(
    ["duskfell-world-render-manifest-v3", "duskfell-world-render-manifest-v4"].includes(manifest.schema),
    "manifest schema is not a supported v3/v4 contract",
    failures,
  );
  check(manifest.state === "review", "generated package must remain in review state", failures);
  check(manifest.world === recipe.id, "manifest world id does not match recipe", failures);
  check(manifest.source?.type === recipe.source.type, "manifest source type does not match recipe", failures);
  check(manifest.source?.model === recipe.source.model, "manifest source model does not match recipe", failures);

  const { cols, rows, unitsPerTile } = recipe.dimensions;
  if (recipe.source.type === "terrain-diffusion" || recipe.source.type === "atlas-region-v1") {
    const artifact = manifest.sourceArtifact;
    const label = recipe.source.type === "terrain-diffusion" ? "Terrain Diffusion" : "atlas region";
    check(artifact && typeof artifact === "object", `${label} package must embed its source artifact`, failures);
    const sourcePath = resolvePackagePath(root, artifact?.path);
    const metadataPath = resolvePackagePath(root, artifact?.metadata);
    checkFile(sourcePath, `${label} source payload`, failures);
    checkFile(metadataPath, `${label} source metadata`, failures);
    if (fs.existsSync(sourcePath)) check(artifact?.sha256 === sha256(sourcePath), `${label} source payload hash does not match`, failures);
    if (fs.existsSync(metadataPath)) {
      const metadata = readJson(root, path.basename(metadataPath), failures);
      const expectedSchema = recipe.source.type === "terrain-diffusion" ? "duskfell-terrain-source-v1" : "duskfell-atlas-region-source-v1";
      check(metadata?.schema === expectedSchema, `${label} source metadata schema is invalid`, failures);
      check(metadata?.model === recipe.source.model, `${label} source metadata model does not match recipe`, failures);
      if (recipe.source.type === "terrain-diffusion") {
        check(metadata?.scale === recipe.source.scale, "Terrain Diffusion source metadata scale does not match recipe", failures);
        check(metadata?.region?.i === recipe.source.region.i && metadata?.region?.j === recipe.source.region.j, "Terrain Diffusion source metadata region does not match recipe", failures);
      } else {
        check(metadata?.region?.x === recipe.source.region.x && metadata?.region?.y === recipe.source.region.y, "atlas region source coordinate does not match recipe", failures);
        check(JSON.stringify(metadata?.atlas) === JSON.stringify(recipe.source.atlas), "atlas region source parent hashes do not match recipe", failures);
        check(metadata?.normalization?.elevationLow === 0 && metadata?.normalization?.elevationHigh > 0, "atlas region source normalization is invalid", failures);
        check(metadata?.inheritedRiverChannel === 1, "atlas region source inherited river channel is invalid", failures);
        check(Number.isInteger(metadata?.erosionSeed) && metadata.erosionSeed >= 0, "atlas region source erosion seed is invalid", failures);
        check(metadata?.inheritedRiverRasterizer === "atlas-flow-segments-distance-field-v1", "atlas region source inherited river rasterizer is invalid", failures);
        check(metadata?.drainageGates && ["north", "east", "south", "west"].every((side) => Array.isArray(metadata.drainageGates[side])), "atlas region source drainage gates are invalid", failures);
        const expectedOrigin = { x: recipe.source.region.x * cols, y: recipe.source.region.y * rows };
        check(JSON.stringify(metadata?.tileOrigin) === JSON.stringify(expectedOrigin), "atlas region source tile origin is invalid", failures);
        check(JSON.stringify(metadata?.neighbors) === JSON.stringify(bundle.generation?.source?.neighbors), "atlas region source neighbors drift from bundle", failures);
        const atlasId = recipe.source.atlas.id;
        const neighborId = (x, y) => `${atlasId}-r${x}-${y}`;
        const neighbors = metadata?.neighbors;
        check(neighbors && ["north", "east", "south", "west"].every((side) => neighbors[side] === null || typeof neighbors[side] === "string"), "atlas region source neighbors are invalid", failures);
        check(neighbors?.north === (recipe.source.region.y > 0 ? neighborId(recipe.source.region.x, recipe.source.region.y - 1) : null), "atlas north neighbor is invalid", failures);
        check(neighbors?.west === (recipe.source.region.x > 0 ? neighborId(recipe.source.region.x - 1, recipe.source.region.y) : null), "atlas west neighbor is invalid", failures);
        check(neighbors?.east === null || neighbors?.east === neighborId(recipe.source.region.x + 1, recipe.source.region.y), "atlas east neighbor is invalid", failures);
        check(neighbors?.south === null || neighbors?.south === neighborId(recipe.source.region.x, recipe.source.region.y + 1), "atlas south neighbor is invalid", failures);
      }
      check(metadata?.sha256 === artifact?.sha256, `${label} source metadata hash does not match manifest`, failures);
      const apronSamples = recipe.macro.apronTiles * recipe.source.samplesPerTile;
      check(metadata?.width === cols * recipe.source.samplesPerTile + apronSamples * 2 + 1, `${label} source width is invalid`, failures);
      check(metadata?.height === rows * recipe.source.samplesPerTile + apronSamples * 2 + 1, `${label} source height is invalid`, failures);
      check(metadata?.apronTiles === recipe.macro.apronTiles, `${label} source apron is invalid`, failures);
    }
  }
  check(bundle.dimensions?.cols === cols && bundle.dimensions?.rows === rows, "bundle dimensions do not match recipe", failures);
  check(bundle.dimensions?.unitsPerTile === unitsPerTile, "bundle tile units do not match recipe", failures);
  checkGrid(bundle.heights, rows + 1, cols + 1, "heights", failures, { bounded: false });
  if (recipe.source.type === "terrain-diffusion" || recipe.source.type === "atlas-region-v1") {
    const samples = recipe.source.samplesPerTile;
    const authority = bundle.authority;
    check(authority?.schema === "duskfell-terrain-authority-v1", "canonical terrain authority schema is invalid", failures);
    check(authority?.samplesPerTile === samples, "canonical terrain sampling does not match recipe", failures);
    check(authority?.vertexCols === cols * samples + 1 && authority?.vertexRows === rows * samples + 1, "canonical terrain vertex dimensions are invalid", failures);
    check(authority?.cellCols === cols * samples && authority?.cellRows === rows * samples, "canonical terrain cell dimensions are invalid", failures);
    checkGrid(authority?.elevation, rows * samples + 1, cols * samples + 1, "authority.elevation", failures);
    checkGrid(authority?.preErosionElevation, rows * samples + 1, cols * samples + 1, "authority.preErosionElevation", failures, { bounded: false });
    checkGrid(authority?.erosionDelta, rows * samples + 1, cols * samples + 1, "authority.erosionDelta", failures, { bounded: false });
    check(bundle.generation?.erosion?.schema === "duskfell-erosion-authority-v1", "erosion authority metadata is invalid", failures);
    check(bundle.generation?.erosion?.deterministic === true, "erosion authority must be deterministic", failures);
    for (const field of ["water", "river", "snow"]) checkGrid(authority?.[field], rows * samples, cols * samples, `authority.${field}`, failures);
    authorityDerivation: for (let y = 0; y <= rows; y += 1) for (let x = 0; x <= cols; x += 1) {
      const difference = Math.abs((bundle.heights?.[y]?.[x] ?? Infinity) - (authority?.elevation?.[y * samples]?.[x * samples] ?? -Infinity));
      if (difference > 0.00001) {
        failures.push(`coarse height ${x},${y} drifts from canonical terrain authority`);
        break authorityDerivation;
      }
    }
  }
  validateWaterAuthority(bundle, recipe, failures);
  for (const field of FIELDS) checkGrid(bundle.fields?.[field], rows, cols, `fields.${field}`, failures);
  const climateMetrics = validateClimateAuthority(bundle, recipe, failures);
  for (const biome of BIOMES) checkGrid(bundle.biomeWeights?.[biome], rows, cols, `biomeWeights.${biome}`, failures);
  validateMaterialWeights(bundle, failures);
  check(Array.isArray(bundle.legacy?.materialGrid) && bundle.legacy.materialGrid.length === rows, "legacy material grid row count is invalid", failures);
  for (const [index, row] of (bundle.legacy?.materialGrid ?? []).entries()) {
    check(typeof row === "string" && row.length === cols && /^[0-9a-z]*$/i.test(row), `legacy material row ${index} is invalid`, failures);
  }

  let maxWeightError = 0;
  let waterTiles = 0;
  let snowTiles = 0;
  const atlasRegion = recipe.source.type === "atlas-region-v1";
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const total = BIOMES.reduce((sum, biome) => sum + (bundle.biomeWeights?.[biome]?.[y]?.[x] ?? 0), 0);
      maxWeightError = Math.max(maxWeightError, Math.abs(1 - total));
      if ((bundle.fields?.water?.[y]?.[x] ?? 0) > 0.65) waterTiles += 1;
      if ((bundle.fields?.snow?.[y]?.[x] ?? 0) > 0.3) snowTiles += 1;
    }
  }
  check(maxWeightError <= 0.002, `biome weights drift by ${maxWeightError}`, failures);
  if (!atlasRegion) {
    check(waterTiles > 0, "world has no authoritative water tiles", failures);
    check(snowTiles > 0, "world has no qualifying high-country snow", failures);
  }

  let maxRiverStep = 0;
  let prior = null;
  for (const point of bundle.hydrology?.riverCenterline ?? []) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      failures.push("river centerline contains an invalid point");
      continue;
    }
    if (prior) maxRiverStep = Math.max(maxRiverStep, Math.hypot(point.x - prior.x, point.y - prior.y));
    prior = point;
  }
  const inheritedGates = atlasRegion
    ? ["north", "east", "south", "west"].flatMap((side) => bundle.generation?.source?.drainageGates?.[side] ?? [])
    : [];
  const minimumRiverLength = recipe.source.type === "synthetic-v2"
    ? rows
    : atlasRegion && inheritedGates.length === 0 ? 0 : Math.max(6, Math.floor(Math.min(cols, rows) * 0.12));
  check((bundle.hydrology?.riverCenterline?.length ?? 0) >= minimumRiverLength, `river centerline is shorter than ${minimumRiverLength} tiles`, failures);
  check((bundle.hydrology?.riverCenterline?.length ?? Infinity) <= (cols + rows) * 2, "river centerline exceeds the bounded point budget", failures);
  check(maxRiverStep < 2.5, `river centerline discontinuity is ${maxRiverStep} tiles`, failures);
  const hydrologyMetrics = validateHydrologyAuthority(bundle, recipe, failures);

  const settlements = bundle.features?.settlements ?? [];
  const trails = bundle.features?.trails ?? [];
  check(bundle.features?.schema === "duskfell-world-features-v1", "world feature schema is invalid", failures);
  check(settlements.length === recipe.planning.settlements, "settlement count does not match recipe", failures);
  const settlementIds = new Set();
  for (const settlement of settlements) {
    const x = Math.floor(settlement?.x);
    const y = Math.floor(settlement?.y);
    check(typeof settlement?.id === "string" && !settlementIds.has(settlement.id), "settlement id is missing or duplicated", failures);
    settlementIds.add(settlement?.id);
    check(x >= 0 && y >= 0 && x < cols && y < rows, `settlement ${settlement?.id ?? "unknown"} is outside the world`, failures);
    if (x >= 0 && y >= 0 && x < cols && y < rows) {
      check(bundle.fields.water[y][x] <= 0.25, `settlement ${settlement.id} is in authoritative water`, failures);
      check(bundle.fields.slope[y][x] <= recipe.planning.maxTrailSlope, `settlement ${settlement.id} exceeds the trail slope limit`, failures);
    }
  }
  for (let left = 0; left < settlements.length; left += 1) for (let right = left + 1; right < settlements.length; right += 1) {
    const distance = Math.hypot(settlements[left].x - settlements[right].x, settlements[left].y - settlements[right].y);
    check(distance >= recipe.planning.minSettlementSpacing, `settlements ${settlements[left].id} and ${settlements[right].id} violate minimum spacing`, failures);
  }
  check(trails.length === Math.max(0, settlements.length - 1), "trail network is not a minimal connected settlement network", failures);
  let trailTiles = 0;
  for (const trail of trails) {
    check(settlementIds.has(trail?.from) && settlementIds.has(trail?.to), `trail ${trail?.id ?? "unknown"} has an invalid endpoint`, failures);
    check(trail?.width === recipe.planning.trailWidth, `trail ${trail?.id ?? "unknown"} width does not match recipe`, failures);
    check(Array.isArray(trail?.points) && trail.points.length >= 2, `trail ${trail?.id ?? "unknown"} has no navigable path`, failures);
    const bridgeTiles = new Set((trail?.bridges ?? []).map((point) => `${Math.floor(point.x)},${Math.floor(point.y)}`));
    let previous = null;
    let consecutiveBridgeTiles = 0;
    let maxConsecutiveBridgeTiles = 0;
    for (const point of trail?.points ?? []) {
      trailTiles += 1;
      const x = Math.floor(point?.x);
      const y = Math.floor(point?.y);
      check(x >= 0 && y >= 0 && x < cols && y < rows, `trail ${trail.id} leaves the world`, failures);
      if (previous) check(Math.hypot(point.x - previous.x, point.y - previous.y) <= Math.SQRT2 + 0.001, `trail ${trail.id} is discontinuous`, failures);
      if (x >= 0 && y >= 0 && x < cols && y < rows) {
        check(bundle.fields.slope[y][x] <= recipe.planning.maxTrailSlope, `trail ${trail.id} exceeds the slope limit`, failures);
        if (bundle.fields.water[y][x] > 0.3) {
          check(bridgeTiles.has(`${x},${y}`), `trail ${trail.id} has an unrecorded water crossing`, failures);
          consecutiveBridgeTiles += 1;
          maxConsecutiveBridgeTiles = Math.max(maxConsecutiveBridgeTiles, consecutiveBridgeTiles);
        } else {
          consecutiveBridgeTiles = 0;
        }
      }
      previous = point;
    }
    check(maxConsecutiveBridgeTiles <= 4, `trail ${trail.id} requires a bridge longer than four tiles`, failures);
  }

  const ecologyMetrics = validateEcology(bundle, recipe, terrainDetailPatch, failures);

  const recipeHash = sha256(path.join(root, "recipe.json"));
  const bundleHash = sha256(path.join(root, "world-bundle-v2.json"));
  check(manifest.recipeSha256 === recipeHash, "recipe hash does not match manifest", failures);
  check(manifest.bundleSha256 === bundleHash, "bundle hash does not match manifest", failures);
  check(patch.sourceBundleSha256 === bundleHash, "server patch source hash does not match bundle", failures);
  check(patch.activation?.startsWith("review-only"), "server patch is not explicitly review-only", failures);
  check(patch.region?.cols === cols && patch.region?.rows === rows, "server patch region dimensions do not match recipe", failures);
  check(patch.targetWorld?.cols === recipe.placement.targetCols && patch.targetWorld?.rows === recipe.placement.targetRows, "server patch target placement does not match recipe", failures);
  checkGrid(patch.authority?.vertexHeights, rows + 1, cols + 1, "server patch vertexHeights", failures, { bounded: false });
  const vertexHeightPrecision = patch.authority?.vertexHeightPrecision;
  check(
    Number.isInteger(vertexHeightPrecision) && vertexHeightPrecision >= 1 && vertexHeightPrecision <= 100_000,
    "server patch vertexHeightPrecision must be an integer between 1 and 100000",
    failures,
  );
  check(
    (patch.authority?.vertexHeights ?? []).every((row) => row.every(Number.isInteger)),
    "server patch vertex heights must be fixed-point integers",
    failures,
  );
  check(
    Number.isInteger(vertexHeightPrecision)
      && JSON.stringify(patch.authority?.vertexHeights ?? null) === JSON.stringify(bundle.legacy.heights.map((row) => row.map((height) => Math.round(height * vertexHeightPrecision)))),
    "server patch vertex heights drift from fixed-point bundle authority",
    failures,
  );
  check(JSON.stringify(patch.authority?.materialGrid ?? null) === JSON.stringify(bundle.legacy.materialGrid), "server patch material grid drifts from the world bundle", failures);
  check(JSON.stringify(patch.features) === JSON.stringify(bundle.features), "server patch features drift from the world bundle", failures);
  check(JSON.stringify(patch.canonicalTerrain ?? null) === JSON.stringify(bundle.authority ?? null), "server patch canonical terrain drifts from the world bundle", failures);

  for (const [name, expectedPpt] of [
    ["gameplay", recipe.macro.gameplayPixelsPerTile],
    ["travel", recipe.macro.travelPixelsPerTile],
    ["worldMap", recipe.macro.worldMapPixelsPerTile],
  ]) {
    const raster = manifest.rasters?.[name];
    if (!raster) {
      failures.push(`manifest is missing ${name} raster`);
      continue;
    }
    check(raster.path === path.basename(raster.path ?? ""), `${name} raster path must be package-local`, failures);
    const rasterPath = resolvePackagePath(root, raster.path);
    checkFile(rasterPath, `${name} raster`, failures);
    if (!fs.existsSync(rasterPath)) continue;
    const dimensions = pngDimensions(rasterPath);
    check(dimensions.width === cols * expectedPpt && dimensions.height === rows * expectedPpt, `${name} raster dimensions are invalid`, failures);
    check(raster.pixelsPerTile === expectedPpt, `${name} pixels-per-tile metadata is invalid`, failures);
    check(raster.sha256 === sha256(rasterPath), `${name} raster hash does not match`, failures);
  }

  const reviewPath = resolvePackagePath(root, manifest.reviewSheet?.path);
  checkFile(reviewPath, "review sheet", failures);
  if (fs.existsSync(reviewPath)) check(manifest.reviewSheet.sha256 === sha256(reviewPath), "review sheet hash does not match", failures);
  checkedFileReference(root, manifest.ecologyReview, "ecology review", failures);
  checkedFileReference(root, manifest.terrainDetailPatch, "terrain detail authority patch", failures);
  const chunkMetrics = validateChunkPackage(root, manifest, bundle, recipe, failures);
  validateAuthoringProvenance(root, manifest, bundle, recipe, failures);

  if (recipe.illustration.enabled) validateIllustration(root, recipe, manifest, failures);
  else check(!manifest.illustration, "illustration metadata exists for a disabled recipe", failures);

  const metrics = {
    dimensions: { cols, rows, unitsPerTile },
    tiles: cols * rows,
    maxBiomeWeightError: maxWeightError,
    waterTiles,
    snowTiles,
    maxRiverStepTiles: maxRiverStep,
    ...hydrologyMetrics,
    settlements: settlements.length,
    trails: trails.length,
    trailTiles,
    source: { type: recipe.source.type, model: recipe.source.model },
    ...climateMetrics,
    authoritySamplesPerTile: bundle.authority?.samplesPerTile ?? 1,
    ...ecologyMetrics,
    ...chunkMetrics,
    vertexHeightPrecision,
  };
  return finish(root, recipe, failures, metrics, writeReport);
}

function validateChunkPackage(root, manifest, bundle, recipe, failures) {
  const reference = manifest.chunkIndex;
  check(reference?.path === "chunks/index.json", "chunk index path is invalid", failures);
  const indexPath = path.join(root, "chunks", "index.json");
  checkFile(indexPath, "chunk index", failures);
  if (!fs.existsSync(indexPath)) return { chunks: 0 };
  check(reference?.sha256 === sha256(indexPath), "chunk index hash does not match", failures);
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch (error) {
    failures.push(`chunk index is malformed: ${error.message}`);
    return { chunks: 0 };
  }
  const { cols, rows } = bundle.dimensions;
  check(index?.schema === "duskfell-world-chunk-index-v1", "chunk index schema is invalid", failures);
  check(index?.world === bundle.id, "chunk index world id is invalid", failures);
  check(index?.sourceBundleContentSha256 === bundle.contentSha256, "chunk index source hash does not match bundle content", failures);
  check(index?.chunkTiles === recipe.macro.tiles && index?.apronTiles === recipe.macro.apronTiles, "chunk geometry drifts from recipe", failures);
  check(index?.vertexHeightPrecision === 1000, "chunk fixed-point height precision is invalid", failures);
  check(index?.waterAuthority?.schema === "duskfell-water-authority-v1", "chunk index water authority schema is invalid", failures);
  check(index?.waterAuthority?.samplesPerTile === bundle.waterAuthority?.samplesPerTile, "chunk index water sampling drifts from bundle", failures);
  check(index?.materialWeights?.schema === "duskfell-material-weights-v1", "chunk index material-weight schema is invalid", failures);
  check(index?.materialWeights?.algorithm === bundle.materialWeights?.algorithm, "chunk index material-weight algorithm drifts from bundle", failures);
  check(index?.materialWeights?.normalization === bundle.materialWeights?.normalization, "chunk index material-weight normalization drifts from bundle", failures);
  check(JSON.stringify(index?.materialWeights?.families) === JSON.stringify(bundle.materialWeights?.families), "chunk index material families drift from bundle", failures);
  const expectedChunkCols = Math.ceil(cols / recipe.macro.tiles);
  const expectedChunkRows = Math.ceil(rows / recipe.macro.tiles);
  check(index?.grid?.cols === expectedChunkCols && index?.grid?.rows === expectedChunkRows, "chunk grid dimensions are invalid", failures);
  check(reference?.count === expectedChunkCols * expectedChunkRows, "manifest chunk count is invalid", failures);
  check(index?.chunks?.length === expectedChunkCols * expectedChunkRows, "chunk index count is invalid", failures);
  const coverage = Array.from({ length: rows }, () => Array(cols).fill(0));
  let totalBytes = 0;
  for (const entry of index?.chunks ?? []) {
    check(/^chunks\/chunk-[0-9]+-[0-9]+\.json$/.test(entry?.path ?? ""), `chunk ${entry?.id ?? "unknown"} path is invalid`, failures);
    const chunkPath = path.join(root, entry?.path ?? ".missing");
    checkFile(chunkPath, `chunk ${entry?.id ?? "unknown"}`, failures);
    if (!fs.existsSync(chunkPath)) continue;
    check(entry.sha256 === sha256(chunkPath), `chunk ${entry.id} hash does not match`, failures);
    check(entry.bytes === fs.statSync(chunkPath).size, `chunk ${entry.id} byte count does not match`, failures);
    totalBytes += entry.bytes ?? 0;
    let chunk;
    try {
      chunk = JSON.parse(fs.readFileSync(chunkPath, "utf8"));
    } catch (error) {
      failures.push(`chunk ${entry.id} is malformed: ${error.message}`);
      continue;
    }
    check(chunk.schema === "duskfell-world-chunk-v1" && chunk.world === bundle.id && chunk.id === entry.id, `chunk ${entry.id} identity is invalid`, failures);
    check(JSON.stringify(chunk.core) === JSON.stringify(entry.core) && JSON.stringify(chunk.sample) === JSON.stringify(entry.sample), `chunk ${entry.id} bounds drift from index`, failures);
    const core = chunk.core;
    const sample = chunk.sample;
    const expectedSample = {
      x: Math.max(0, core.x - recipe.macro.apronTiles),
      y: Math.max(0, core.y - recipe.macro.apronTiles),
      cols: Math.min(cols, core.x + core.cols + recipe.macro.apronTiles) - Math.max(0, core.x - recipe.macro.apronTiles),
      rows: Math.min(rows, core.y + core.rows + recipe.macro.apronTiles) - Math.max(0, core.y - recipe.macro.apronTiles),
    };
    check(JSON.stringify(sample) === JSON.stringify(expectedSample), `chunk ${entry.id} apron bounds are invalid`, failures);
    for (let y = core.y; y < core.y + core.rows; y += 1) for (let x = core.x; x < core.x + core.cols; x += 1) {
      if (coverage[y]?.[x] !== undefined) coverage[y][x] += 1;
    }
    check(JSON.stringify(chunk.heights) === JSON.stringify(sliceGrid(bundle.heights, sample.x, sample.y, sample.cols + 1, sample.rows + 1)), `chunk ${entry.id} height apron drifts from authority`, failures);
    const expectedVertexHeights = sliceGrid(bundle.legacy.heights, sample.x, sample.y, sample.cols + 1, sample.rows + 1)
      .map((row) => row.map((height) => Math.round(height * index.vertexHeightPrecision)));
    check(chunk.vertexHeightPrecision === index.vertexHeightPrecision, `chunk ${entry.id} fixed-point height precision drifts from index`, failures);
    check(JSON.stringify(chunk.vertexHeights) === JSON.stringify(expectedVertexHeights), `chunk ${entry.id} fixed-point height apron drifts from authority`, failures);
    for (const [name, values] of Object.entries(bundle.fields)) {
      check(JSON.stringify(chunk.fields?.[name]) === JSON.stringify(sliceGrid(values, sample.x, sample.y, sample.cols, sample.rows)), `chunk ${entry.id} field ${name} drifts from authority`, failures);
    }
    for (const [name, values] of Object.entries(bundle.biomeWeights)) {
      check(JSON.stringify(chunk.biomeWeights?.[name]) === JSON.stringify(sliceGrid(values, sample.x, sample.y, sample.cols, sample.rows)), `chunk ${entry.id} biome ${name} drifts from authority`, failures);
    }
    check(JSON.stringify(chunk.waterAuthority) === JSON.stringify(expectedChunkWaterAuthority(bundle.waterAuthority, sample)), `chunk ${entry.id} water authority drifts from bundle`, failures);
    const expectedMaterialWeights = {
      schema: bundle.materialWeights.schema,
      algorithm: bundle.materialWeights.algorithm,
      normalization: bundle.materialWeights.normalization,
      families: bundle.materialWeights.families,
      weights: Object.fromEntries(Object.entries(bundle.materialWeights.weights).map(([name, values]) => [name, sliceGrid(values, sample.x, sample.y, sample.cols, sample.rows)])),
    };
    check(JSON.stringify(chunk.materialWeights) === JSON.stringify(expectedMaterialWeights), `chunk ${entry.id} material weights drift from bundle`, failures);
    const expectedMaterials = bundle.legacy.materialGrid.slice(sample.y, sample.y + sample.rows).map((row) => row.slice(sample.x, sample.x + sample.cols));
    const expectedZones = bundle.climate.zones.rows.slice(sample.y, sample.y + sample.rows).map((row) => row.slice(sample.x, sample.x + sample.cols));
    check(JSON.stringify(chunk.materialGrid) === JSON.stringify(expectedMaterials), `chunk ${entry.id} materials drift from authority`, failures);
    check(JSON.stringify(chunk.climateZoneRows) === JSON.stringify(expectedZones), `chunk ${entry.id} climate zones drift from authority`, failures);
  }
  check(coverage.every((row) => row.every((count) => count === 1)), "chunk cores do not cover every tile exactly once", failures);
  const visualMetrics = validateChunkVisualControls(root, manifest, bundle, recipe, index, failures);
  return {
    chunks: index?.chunks?.length ?? 0,
    chunkAuthorityBytes: totalBytes,
    ...visualMetrics,
  };
}

function validateMaterialWeights(bundle, failures) {
  const authority = bundle.materialWeights;
  const { cols, rows } = bundle.dimensions;
  check(authority?.schema === "duskfell-material-weights-v1", "material-weight schema is invalid", failures);
  check(authority?.algorithm === "continuous-terrain-family-blend-v1", "material-weight algorithm is invalid", failures);
  check(authority?.normalization === "sum-to-one-per-tile", "material-weight normalization is invalid", failures);
  check(JSON.stringify(authority?.families) === JSON.stringify(MATERIAL_WEIGHT_FAMILIES), "material-weight families are invalid", failures);
  for (const family of MATERIAL_WEIGHT_FAMILIES) checkGrid(authority?.weights?.[family], rows, cols, `materialWeights.${family}`, failures);
  materialSamples: for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    const total = MATERIAL_WEIGHT_FAMILIES.reduce((sum, family) => sum + (authority?.weights?.[family]?.[y]?.[x] ?? 0), 0);
    if (Math.abs(total - 1) > 0.000002) {
      failures.push(`material weights are not normalized at ${x},${y}`);
      break materialSamples;
    }
  }
}

function validateWaterAuthority(bundle, recipe, failures) {
  const authority = bundle.waterAuthority;
  const terrain = bundle.authority;
  const samples = recipe.source.type === "synthetic-v2" ? 1 : recipe.source.samplesPerTile;
  const rows = bundle.dimensions.rows * samples;
  const cols = bundle.dimensions.cols * samples;
  check(authority?.schema === "duskfell-water-authority-v1", "water authority schema is invalid", failures);
  check(authority?.algorithm === "priority-flood-surface-depth-flow-v1", "water authority algorithm is invalid", failures);
  check(authority?.samplesPerTile === samples, "water authority sampling is invalid", failures);
  check(authority?.unitsPerTile === bundle.dimensions.unitsPerTile, "water authority tile scale is invalid", failures);
  check(authority?.heightEncoding === "world-elevation-levels-v1" && authority?.heightScale === 2, "water authority height encoding is invalid", failures);
  check(authority?.cellCols === cols && authority?.cellRows === rows, "water authority dimensions are invalid", failures);
  checkGrid(authority?.wetMask, rows, cols, "waterAuthority.wetMask", failures);
  checkGrid(authority?.surfaceHeight, rows, cols, "waterAuthority.surfaceHeight", failures, { bounded: false });
  checkGrid(authority?.depth, rows, cols, "waterAuthority.depth", failures, { bounded: false });
  checkGrid(authority?.flowDirectionD8, rows, cols, "waterAuthority.flowDirectionD8", failures, { bounded: false });
  checkGrid(authority?.flowStrength, rows, cols, "waterAuthority.flowStrength", failures);
  const elevations = terrain?.elevation;
  const wet = terrain?.water;
  if (!Array.isArray(elevations) || !Array.isArray(wet)) return;
  waterSamples: for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    const mask = authority.wetMask?.[y]?.[x];
    const depth = authority.depth?.[y]?.[x];
    const surface = authority.surfaceHeight?.[y]?.[x];
    const direction = authority.flowDirectionD8?.[y]?.[x];
    if (Math.abs(mask - wet[y][x]) > 0.000001) {
      failures.push(`water authority wet mask drifts at ${x},${y}`);
      break waterSamples;
    }
    if (!Number.isFinite(depth) || depth < 0 || !Number.isFinite(surface) || !Number.isInteger(direction) || direction < -1 || direction > 7) {
      failures.push("water authority contains an invalid physical sample");
      break waterSamples;
    }
    if (mask <= 0.001) {
      if (depth !== 0 || surface !== 0 || direction !== -1) failures.push(`dry water authority sample is active at ${x},${y}`);
      continue;
    }
    const bed = (elevations[y][x] + elevations[y][x + 1] + elevations[y + 1][x] + elevations[y + 1][x + 1]) * 0.25 * authority.heightScale;
    if (Math.abs(surface - depth - bed) > 0.00001) {
      failures.push(`water authority surface/depth drifts from terrain at ${x},${y}`);
      break waterSamples;
    }
  }
}

function expectedChunkWaterAuthority(authority, tileSample) {
  const samples = authority.samplesPerTile;
  const sample = { x: tileSample.x * samples, y: tileSample.y * samples, cols: tileSample.cols * samples, rows: tileSample.rows * samples };
  return {
    schema: authority.schema,
    algorithm: authority.algorithm,
    samplesPerTile: samples,
    unitsPerTile: authority.unitsPerTile,
    heightEncoding: authority.heightEncoding,
    heightScale: authority.heightScale,
    sample,
    wetMask: sliceGrid(authority.wetMask, sample.x, sample.y, sample.cols, sample.rows),
    surfaceHeight: sliceGrid(authority.surfaceHeight, sample.x, sample.y, sample.cols, sample.rows),
    depth: sliceGrid(authority.depth, sample.x, sample.y, sample.cols, sample.rows),
    flowDirectionD8: sliceGrid(authority.flowDirectionD8, sample.x, sample.y, sample.cols, sample.rows),
    flowStrength: sliceGrid(authority.flowStrength, sample.x, sample.y, sample.cols, sample.rows),
  };
}

function validateChunkVisualControls(root, manifest, bundle, recipe, chunkIndex, failures) {
  const structuralGameplay = manifest.structuralRasters?.gameplay ?? manifest.rasters.gameplay;
  const illustrationControl = manifest.illustration?.execution === "chunked-v1"
    ? {
      path: manifest.illustration.control?.path,
      sha256: manifest.illustration.control?.sha256,
      width: manifest.illustration.control?.width,
      height: manifest.illustration.control?.height,
      pixelsPerTile: manifest.illustration.control?.pixelsPerTile,
    }
    : null;
  const control = validateChunkVisualSet(root, manifest, bundle, recipe, chunkIndex, failures, {
    role: "control",
    schema: "duskfell-chunk-visual-control-index-v1",
    directory: "chunks/visual-controls",
    sourceRaster: illustrationControl ?? structuralGameplay,
    required: manifest.schema === "duskfell-world-render-manifest-v4",
  });
  const illustrated = validateChunkVisualSet(root, manifest, bundle, recipe, chunkIndex, failures, {
    role: "illustrated",
    schema: "duskfell-chunk-visual-illustrated-index-v1",
    directory: "chunks/visual-illustrated",
    sourceRaster: manifest.rasters.gameplay,
    required: Boolean(manifest.illustration),
  });
  return {
    chunkVisualControlBytes: control.bytes,
    chunkVisualControlSeams: control.seams,
    chunkVisualSeams: control.seams,
    chunkVisualIllustratedBytes: illustrated.bytes,
    chunkVisualIllustratedSeams: illustrated.seams,
  };
}

function validateChunkVisualSet(root, manifest, bundle, recipe, chunkIndex, failures, config) {
  const reference = manifest.chunkVisuals?.[config.role];
  if (!config.required && !reference) {
    return { bytes: 0, seams: 0 };
  }
  if (!reference) {
    failures.push(`manifest is missing required chunk visual ${config.role} set`);
    return { bytes: 0, seams: 0 };
  }
  const expectedIndexPath = `${config.directory}/index.json`;
  check(reference?.index?.path === expectedIndexPath, `chunk visual ${config.role} index path is invalid`, failures);
  const indexPath = path.join(root, ...expectedIndexPath.split("/"));
  checkFile(indexPath, `chunk visual ${config.role} index`, failures);
  if (!fs.existsSync(indexPath)) return { bytes: 0, seams: 0 };
  check(reference?.index?.sha256 === sha256(indexPath), `chunk visual ${config.role} index hash does not match`, failures);
  let visualIndex;
  try {
    visualIndex = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch (error) {
    failures.push(`chunk visual ${config.role} index is malformed: ${error.message}`);
    return { bytes: 0, seams: 0 };
  }

  check(visualIndex.schema === config.schema && visualIndex.role === config.role, `chunk visual ${config.role} schema is invalid`, failures);
  check(visualIndex.world === bundle.id, `chunk visual ${config.role} world is invalid`, failures);
  check(visualIndex.sourceBundleContentSha256 === bundle.contentSha256, `chunk visual ${config.role} set drifts from bundle authority`, failures);
  check(visualIndex.sourceChunkIndexSha256 === manifest.chunkIndex.sha256, `chunk visual ${config.role} set drifts from chunk authority index`, failures);
  check(visualIndex.sourceRaster?.path === config.sourceRaster.path, `chunk visual ${config.role} source raster path is invalid`, failures);
  check(visualIndex.sourceRaster?.sha256 === config.sourceRaster.sha256, `chunk visual ${config.role} source raster hash is invalid`, failures);
  check(visualIndex.sourceRaster?.pixelsPerTile === recipe.macro.gameplayPixelsPerTile, `chunk visual ${config.role} resolution is invalid`, failures);
  check(visualIndex.chunkTiles === recipe.macro.tiles && visualIndex.apronTiles === recipe.macro.apronTiles, `chunk visual ${config.role} geometry drifts from recipe`, failures);
  check(JSON.stringify(visualIndex.grid) === JSON.stringify(chunkIndex.grid), `chunk visual ${config.role} grid drifts from authority chunks`, failures);
  check(reference?.count === chunkIndex.chunks.length, `chunk visual ${config.role} manifest count is invalid`, failures);
  check(visualIndex.entries?.length === chunkIndex.chunks.length, `chunk visual ${config.role} entry count is invalid`, failures);
  check(reference?.pixelsPerTile === recipe.macro.gameplayPixelsPerTile, `chunk visual ${config.role} manifest resolution is invalid`, failures);

  const authorityById = new Map(chunkIndex.chunks.map((entry) => [entry.id, entry]));
  const entriesById = new Map();
  let totalBytes = 0;
  let allImagesReadable = true;
  for (const entry of visualIndex.entries ?? []) {
    const authority = authorityById.get(entry?.id);
    check(Boolean(authority) && !entriesById.has(entry?.id), `chunk visual ${entry?.id ?? "unknown"} identity is invalid`, failures);
    entriesById.set(entry?.id, entry);
    if (!authority) continue;
    check(JSON.stringify(entry.coord) === JSON.stringify(authority.coord), `chunk visual ${entry.id} coordinate drifts from authority`, failures);
    check(JSON.stringify(entry.core) === JSON.stringify(authority.core), `chunk visual ${entry.id} core drifts from authority`, failures);
    check(JSON.stringify(entry.sample) === JSON.stringify(authority.sample), `chunk visual ${entry.id} apron drifts from authority`, failures);
    const escapedDirectory = config.directory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const imagePathValid = new RegExp(`^${escapedDirectory}/chunk-${entry.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.png$`).test(entry.image?.path ?? "");
    check(imagePathValid, `chunk visual ${entry.id} image path is invalid`, failures);
    const imagePath = imagePathValid ? path.join(root, ...entry.image.path.split("/")) : path.join(root, ".missing");
    checkFile(imagePath, `chunk visual ${entry.id} image`, failures);
    if (!fs.existsSync(imagePath)) {
      allImagesReadable = false;
      continue;
    }
    const expectedWidth = authority.sample.cols * recipe.macro.gameplayPixelsPerTile;
    const expectedHeight = authority.sample.rows * recipe.macro.gameplayPixelsPerTile;
    let dimensions = { width: 0, height: 0 };
    try {
      dimensions = pngDimensions(imagePath);
    } catch (error) {
      failures.push(`chunk visual ${entry.id} is invalid: ${error.message}`);
      allImagesReadable = false;
    }
    check(dimensions.width === expectedWidth && dimensions.height === expectedHeight, `chunk visual ${entry.id} dimensions are invalid`, failures);
    check(entry.image?.width === expectedWidth && entry.image?.height === expectedHeight, `chunk visual ${entry.id} dimension metadata is invalid`, failures);
    check(entry.image?.pixelsPerTile === recipe.macro.gameplayPixelsPerTile, `chunk visual ${entry.id} resolution metadata is invalid`, failures);
    check(entry.image?.sha256 === sha256(imagePath), `chunk visual ${entry.id} hash does not match`, failures);
    check(entry.image?.bytes === fs.statSync(imagePath).size, `chunk visual ${entry.id} byte count does not match`, failures);
    totalBytes += entry.image?.bytes ?? 0;
    const expectedCoreCrop = {
      x: (authority.core.x - authority.sample.x) * recipe.macro.gameplayPixelsPerTile,
      y: (authority.core.y - authority.sample.y) * recipe.macro.gameplayPixelsPerTile,
      width: authority.core.cols * recipe.macro.gameplayPixelsPerTile,
      height: authority.core.rows * recipe.macro.gameplayPixelsPerTile,
    };
    check(JSON.stringify(entry.coreCrop) === JSON.stringify(expectedCoreCrop), `chunk visual ${entry.id} core crop is invalid`, failures);
  }
  check(reference?.totalBytes === totalBytes, `chunk visual ${config.role} total byte count is invalid`, failures);

  const expectedSeamCount = (chunkIndex.grid.cols - 1) * chunkIndex.grid.rows
    + (chunkIndex.grid.rows - 1) * chunkIndex.grid.cols;
  check(reference?.seamCount === expectedSeamCount, "chunk visual manifest seam count is invalid", failures);
  check(visualIndex.seams?.length === expectedSeamCount, "chunk visual seam count is invalid", failures);
  const seamKeys = new Set();
  let decoded = null;
  if (allImagesReadable && entriesById.size === chunkIndex.chunks.length) {
    try {
      decoded = readRgbImages(visualIndex.entries, root);
    } catch (error) {
      failures.push(`chunk visual controls could not be decoded: ${error.message}`);
    }
  }
  for (const seam of visualIndex.seams ?? []) {
    const a = entriesById.get(seam?.a);
    const b = entriesById.get(seam?.b);
    const key = `${seam?.a}:${seam?.b}`;
    check(Boolean(a && b) && !seamKeys.has(key), `chunk visual seam ${key} identity is invalid`, failures);
    seamKeys.add(key);
    if (!a || !b) continue;
    const expectedDirection = b.coord.x === a.coord.x + 1 && b.coord.y === a.coord.y
      ? "east"
      : b.coord.y === a.coord.y + 1 && b.coord.x === a.coord.x ? "south" : null;
    check(seam.direction === expectedDirection, `chunk visual seam ${key} direction is invalid`, failures);
    const expectedIntersection = intersectBounds(a.sample, b.sample);
    check(JSON.stringify(seam.intersection) === JSON.stringify(expectedIntersection), `chunk visual seam ${key} intersection is invalid`, failures);
    const expectedACrop = localPixelCrop(a, expectedIntersection, recipe.macro.gameplayPixelsPerTile);
    const expectedBCrop = localPixelCrop(b, expectedIntersection, recipe.macro.gameplayPixelsPerTile);
    check(JSON.stringify(seam.aCrop) === JSON.stringify(expectedACrop), `chunk visual seam ${key} source crop is invalid`, failures);
    check(JSON.stringify(seam.bCrop) === JSON.stringify(expectedBCrop), `chunk visual seam ${key} destination crop is invalid`, failures);
    if (decoded && expectedIntersection) {
      const aBytes = cropRgb(decoded.get(a.id), a.image.width, expectedACrop.x, expectedACrop.y, expectedACrop.width, expectedACrop.height);
      const bBytes = cropRgb(decoded.get(b.id), b.image.width, expectedBCrop.x, expectedBCrop.y, expectedBCrop.width, expectedBCrop.height);
      const aHash = hashBytes(aBytes);
      const bHash = hashBytes(bBytes);
      check(aHash === bHash, `chunk visual seam ${key} pixels drift`, failures);
      check(seam.rgbSha256 === aHash, `chunk visual seam ${key} hash is invalid`, failures);
    }
  }
  checkedFileReference(root, reference?.review, `chunk visual ${config.role} review`, failures);
  return { bytes: totalBytes, seams: visualIndex.seams?.length ?? 0 };
}

function intersectBounds(left, right) {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.cols, right.x + right.cols);
  const y2 = Math.min(left.y + left.rows, right.y + right.rows);
  return x2 > x && y2 > y ? { x, y, cols: x2 - x, rows: y2 - y } : null;
}

function localPixelCrop(entry, intersection, pixelsPerTile) {
  if (!intersection) return null;
  return {
    x: (intersection.x - entry.sample.x) * pixelsPerTile,
    y: (intersection.y - entry.sample.y) * pixelsPerTile,
    width: intersection.cols * pixelsPerTile,
    height: intersection.rows * pixelsPerTile,
  };
}

function hashBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sliceGrid(values, x, y, cols, rows) {
  return values.slice(y, y + rows).map((row) => row.slice(x, x + cols));
}

function validateClimateAuthority(bundle, recipe, failures) {
  const climate = bundle.climate;
  const { cols, rows } = bundle.dimensions;
  check(climate?.schema === "duskfell-climate-authority-v1", "climate authority schema is invalid", failures);
  check(climate?.algorithm === "orographic-water-balance-v1", "climate authority algorithm is invalid", failures);
  check(climate?.prevailingWind === recipe.climate.prevailingWind, "climate prevailing wind drifts from recipe", failures);
  check(climate?.latitude?.southDegrees === recipe.climate.latitudeSouthDegrees, "climate southern latitude drifts from recipe", failures);
  check(climate?.latitude?.northDegrees === recipe.climate.latitudeNorthDegrees, "climate northern latitude drifts from recipe", failures);
  const zoneRows = climate?.zones?.rows ?? [];
  check(zoneRows.length === rows, "climate zone row count is invalid", failures);
  const zones = new Set();
  for (const [index, row] of zoneRows.entries()) {
    check(typeof row === "string" && row.length === cols && [...row].every((code) => HABITAT_CODES.has(code)), `climate zone row ${index} is invalid`, failures);
    for (const code of row) zones.add(code);
  }
  const minimumZones = recipe.source.type === "atlas-region-v1" ? 1 : 5;
  check(zones.size >= minimumZones, `climate authority has only ${zones.size} distinct zones`, failures);
  check(climate?.seasonality?.calendarDays === 480, "climate season calendar is invalid", failures);
  check(climate?.seasonality?.seasons?.length === 4, "climate authority must declare four seasons", failures);
  const seasonIds = new Set((climate?.seasonality?.seasons ?? []).map((season) => season.id));
  check(["spring", "summer", "autumn", "winter"].every((id) => seasonIds.has(id)), "climate season declarations are incomplete", failures);
  check(climate?.weatherBaseline?.runtimeStatus?.includes("not implemented"), "weather baseline must disclose dynamic runtime status", failures);
  let humidTiles = 0;
  let fogTiles = 0;
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    if (bundle.fields.humidity[y][x] >= recipe.climate.fogHumidityThreshold) humidTiles += 1;
    if (bundle.fields.fogPotential[y][x] > 0.2) fogTiles += 1;
  }
  return { climateZones: zones.size, humidTiles, fogPotentialTiles: fogTiles };
}

function validateHydrologyAuthority(bundle, recipe, failures) {
  const { cols, rows } = bundle.dimensions;
  const authority = bundle.hydrology?.authority;
  check(authority?.schema === "duskfell-hydrology-authority-v1", "hydrology authority schema is invalid", failures);
  check(authority?.algorithm === "priority-flood-d8-watershed-v1", "hydrology authority algorithm is invalid", failures);
  const basinIds = authority?.watersheds?.basinIds;
  const basins = authority?.watersheds?.basins ?? [];
  checkGrid(basinIds, rows, cols, "hydrology watershed ids", failures, { bounded: false });
  const maxBasins = Math.ceil(cols / recipe.hydrology.watershedOutletBucketTiles) * 2 + Math.ceil(rows / recipe.hydrology.watershedOutletBucketTiles) * 2;
  check(basins.length > 0 && basins.length <= maxBasins, "hydrology watershed count is invalid", failures);
  const validBasinIds = new Set(basins.map((basin) => basin.id));
  check(validBasinIds.size === basins.length, "hydrology watershed ids are duplicated", failures);
  check(basins.reduce((sum, basin) => sum + (basin.tiles ?? 0), 0) === cols * rows, "hydrology watershed tile counts do not cover the world", failures);
  for (const basin of basins) {
    check(Number.isInteger(basin.id) && basin.id > 0, "hydrology watershed id is invalid", failures);
    check(Number.isInteger(basin.tiles) && basin.tiles > 0, `hydrology watershed ${basin.id} has no tiles`, failures);
    check(insidePoint(basin.outlet, cols, rows), `hydrology watershed ${basin.id} outlet is invalid`, failures);
  }
  for (const row of basinIds ?? []) for (const id of row ?? []) {
    check(Number.isInteger(id) && validBasinIds.has(id), `hydrology watershed grid references invalid basin ${id}`, failures);
  }

  const tributaries = authority?.tributaries ?? [];
  const minimumTributaries = recipe.source.type === "atlas-region-v1" ? 0 : 1;
  check(tributaries.length >= minimumTributaries && tributaries.length <= recipe.hydrology.maxTributaries, "hydrology tributary count is invalid", failures);
  const tributaryIds = new Set();
  for (const tributary of tributaries) {
    check(typeof tributary.id === "string" && !tributaryIds.has(tributary.id), "hydrology tributary id is missing or duplicated", failures);
    tributaryIds.add(tributary.id);
    check(Number.isInteger(tributary.order) && tributary.order >= 1 && tributary.order <= 4, `hydrology tributary ${tributary.id} order is invalid`, failures);
    check(validBasinIds.has(tributary.watershedId), `hydrology tributary ${tributary.id} watershed is invalid`, failures);
    check(Array.isArray(tributary.points) && tributary.points.length >= recipe.hydrology.minTributaryLengthTiles, `hydrology tributary ${tributary.id} is too short`, failures);
    let previous = null;
    for (const point of tributary.points ?? []) {
      check(insidePoint(point, cols, rows), `hydrology tributary ${tributary.id} leaves the world`, failures);
      if (previous) check(Math.hypot(point.x - previous.x, point.y - previous.y) <= Math.SQRT2 + 0.001, `hydrology tributary ${tributary.id} is discontinuous`, failures);
      previous = point;
    }
    const confluence = tributary.confluence;
    check(insidePoint(confluence, cols, rows), `hydrology tributary ${tributary.id} confluence is invalid`, failures);
    if (insidePoint(confluence, cols, rows)) {
      check(bundle.fields.river[Math.floor(confluence.y)][Math.floor(confluence.x)] > 0.08, `hydrology tributary ${tributary.id} is absent from river authority`, failures);
    }
  }

  const waterBodies = authority?.waterBodies ?? [];
  const inlandBodies = waterBodies.filter((body) => body.bounds?.minX > 0 && body.bounds?.minY > 0 && body.bounds?.maxX < cols - 1 && body.bounds?.maxY < rows - 1);
  for (const body of waterBodies) {
    check(body.kind === "lake" && Number.isInteger(body.tiles) && body.tiles >= 2, `hydrology water body ${body.id ?? "unknown"} is invalid`, failures);
    if (inlandBodies.includes(body)) {
      check(insidePoint(body.outlet?.from, cols, rows) && insidePoint(body.outlet?.to, cols, rows), `inland water body ${body.id} has no outlet`, failures);
    }
  }
  check(authority.shorelineThreshold === recipe.hydrology.shorelineThreshold, "hydrology shoreline threshold does not match recipe", failures);
  const expectedShorelines = countShorelineEdges(bundle.fields.water, recipe.hydrology.shorelineThreshold);
  const shorelineSegments = authority?.shorelineSegments ?? [];
  check(shorelineSegments.length === expectedShorelines, `hydrology shoreline count ${shorelineSegments.length} does not match ${expectedShorelines} authority edges`, failures);
  for (const segment of shorelineSegments) {
    check(["lake", "river"].includes(segment.kind), "hydrology shoreline kind is invalid", failures);
    check(insideVertex(segment.a, cols, rows) && insideVertex(segment.b, cols, rows), "hydrology shoreline segment leaves world bounds", failures);
    check(Math.hypot(segment.a?.x - segment.b?.x, segment.a?.y - segment.b?.y) === 1, "hydrology shoreline segment is not a tile edge", failures);
  }
  return {
    watershedBasins: basins.length,
    tributaries: tributaries.length,
    waterBodies: waterBodies.length,
    shorelineSegments: shorelineSegments.length,
  };
}

function countShorelineEdges(water, threshold) {
  const rows = water.length;
  const cols = water[0].length;
  let count = 0;
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    if (water[y][x] <= threshold) continue;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) if (!(water[y + dy]?.[x + dx] > threshold)) count += 1;
  }
  return count;
}

function insidePoint(point, cols, rows) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y) && point.x >= 0 && point.y >= 0 && point.x < cols && point.y < rows;
}

function insideVertex(point, cols, rows) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y) && point.x >= 0 && point.y >= 0 && point.x <= cols && point.y <= rows;
}

function validateAuthoringProvenance(root, manifest, bundle, recipe, failures) {
  if (!manifest.authoring) return;
  const record = manifest.authoring;
  check(record.path === "authoring-patch.json", "authoring patch path is invalid", failures);
  const authoringPath = resolvePackagePath(root, record.path);
  checkFile(authoringPath, "authoring patch", failures);
  if (!fs.existsSync(authoringPath)) return;
  check(record.sha256 === sha256(authoringPath), "authoring patch hash does not match manifest", failures);
  const authoringPatch = readJson(root, record.path, failures);
  if (!authoringPatch) return;
  check(record.sourceWorld === authoringPatch.source?.world, "authoring source world does not match patch", failures);
  check(record.sourceBundleContentSha256 === authoringPatch.source?.bundleContentSha256, "authoring source bundle hash does not match patch", failures);
  check(JSON.stringify(authoringPatch.features?.settlements) === JSON.stringify(bundle.features?.settlements), "authored settlements drift from world bundle", failures);
  check(JSON.stringify(authoringPatch.features?.trails) === JSON.stringify(bundle.features?.trails), "authored trails drift from world bundle", failures);
  check(JSON.stringify(authoringPatch.features?.landmarks) === JSON.stringify(bundle.ecology?.landmarks), "authored landmarks drift from world bundle", failures);
  check(bundle.generation?.planning?.algorithm === "duskfell-authored-features-v1", "authored package does not record authored planning", failures);
  check(
    bundle.generation?.terrainAuthoring?.operationCount === (authoringPatch.terrain?.operations?.length ?? 0),
    "authored terrain operation count drifts from world bundle",
    failures,
  );
  try {
    const sourceTerrain = structuredClone(bundle);
    sourceTerrain.id = authoringPatch.source?.world;
    sourceTerrain.contentSha256 = authoringPatch.source?.bundleContentSha256;
    validateWorldAuthoringPatch(authoringPatch, sourceTerrain, {
      maxSlope: recipe.planning.maxTrailSlope,
      maxBridgeTiles: 4,
    });
  } catch (error) {
    failures.push(`authoring patch contract is invalid: ${error.message}`);
  }
}

function validateEcology(bundle, recipe, patch, failures) {
  const { cols, rows, unitsPerTile } = bundle.dimensions;
  const ecology = bundle.ecology;
  check(ecology?.schema === "duskfell-world-ecology-v1", "world ecology schema is invalid", failures);
  const habitatRows = ecology?.habitats?.rows ?? [];
  check(habitatRows.length === rows, "habitat authority row count is invalid", failures);
  for (const [index, row] of habitatRows.entries()) {
    check(typeof row === "string" && row.length === cols && [...row].every((code) => HABITAT_CODES.has(code)), `habitat row ${index} is invalid`, failures);
  }
  const patches = ecology?.habitats?.patches ?? [];
  const patchIds = new Set();
  for (const habitatPatch of patches) {
    check(typeof habitatPatch?.id === "string" && !patchIds.has(habitatPatch.id), "habitat patch id is missing or duplicated", failures);
    patchIds.add(habitatPatch?.id);
    check(Number.isInteger(habitatPatch?.tiles) && habitatPatch.tiles >= recipe.ecology.minHabitatPatchTiles, `habitat patch ${habitatPatch?.id ?? "unknown"} is too small`, failures);
    check(Number.isFinite(habitatPatch?.centroid?.x) && Number.isFinite(habitatPatch?.centroid?.y), `habitat patch ${habitatPatch?.id ?? "unknown"} has an invalid centroid`, failures);
  }

  const nodes = ecology?.resourceNodes ?? [];
  check(nodes.length > 0 && nodes.length <= recipe.ecology.maxResourceNodes, "ecology resource node count is outside recipe bounds", failures);
  const nodeIds = new Set();
  for (const node of nodes) {
    check(typeof node?.id === "string" && !nodeIds.has(node.id), "ecology resource node id is missing or duplicated", failures);
    nodeIds.add(node?.id);
    check(Number.isFinite(node?.x) && Number.isFinite(node?.y) && node.x >= 0 && node.y >= 0 && node.x < cols && node.y < rows, `resource node ${node?.id ?? "unknown"} is outside the world`, failures);
    check(RESOURCE_KINDS.has(node?.resource), `resource node ${node?.id ?? "unknown"} has an unsupported resource`, failures);
    check(LIFECYCLE_FAMILIES.has(node?.lifecycle?.family), `resource node ${node?.id ?? "unknown"} has an unsupported lifecycle family`, failures);
    check(typeof node?.lifecycle?.stage === "string" && node.lifecycle.stage.length > 0, `resource node ${node?.id ?? "unknown"} has no lifecycle stage`, failures);
    check(Number.isFinite(node?.lifecycle?.ageYears) && node.lifecycle.ageYears >= 0, `resource node ${node?.id ?? "unknown"} has an invalid age`, failures);
    check(Number.isFinite(node?.lifecycle?.health) && node.lifecycle.health >= 0 && node.lifecycle.health <= 1, `resource node ${node?.id ?? "unknown"} has invalid health`, failures);
    check(Number.isInteger(node?.amount) && Number.isInteger(node?.maxAmount) && node.amount > 0 && node.amount <= node.maxAmount, `resource node ${node?.id ?? "unknown"} has invalid resource amounts`, failures);
    const x = Math.floor(node?.x);
    const y = Math.floor(node?.y);
    if (x >= 0 && y >= 0 && x < cols && y < rows) {
      check(bundle.fields.water[y][x] <= 0.25, `resource node ${node.id} is in authoritative water`, failures);
      check(bundle.fields.slope[y][x] <= recipe.planning.maxTrailSlope, `resource node ${node.id} exceeds the slope limit`, failures);
    }
  }
  for (let left = 0; left < nodes.length; left += 1) for (let right = left + 1; right < nodes.length; right += 1) {
    const distance = Math.hypot(nodes[left].x - nodes[right].x, nodes[left].y - nodes[right].y);
    check(distance + 0.00001 >= recipe.ecology.minResourceSpacingTiles, `resource nodes ${nodes[left].id} and ${nodes[right].id} violate minimum spacing`, failures);
  }

  const landmarks = ecology?.landmarks ?? [];
  check(landmarks.length === recipe.ecology.landmarkCount, "landmark count does not match recipe", failures);
  check(JSON.stringify(bundle.features?.landmarks ?? null) === JSON.stringify(landmarks), "feature landmarks drift from ecology authority", failures);
  const landmarkIds = new Set();
  for (const landmark of landmarks) {
    check(typeof landmark?.id === "string" && !landmarkIds.has(landmark.id), "landmark id is missing or duplicated", failures);
    landmarkIds.add(landmark?.id);
    check(LANDMARK_TYPES.has(landmark?.type), `landmark ${landmark?.id ?? "unknown"} has an unsupported type`, failures);
    check(Number.isFinite(landmark?.x) && Number.isFinite(landmark?.y) && landmark.x >= 0 && landmark.y >= 0 && landmark.x < cols && landmark.y < rows, `landmark ${landmark?.id ?? "unknown"} is outside the world`, failures);
    check(bundle.features.settlements.some((settlement) => settlement.id === landmark?.accessFrom), `landmark ${landmark?.id ?? "unknown"} has no valid access settlement`, failures);
    check(Number.isFinite(landmark?.composition?.ageYears) && landmark.composition.ageYears >= 0, `landmark ${landmark?.id ?? "unknown"} has no valid decay age`, failures);
  }
  for (let left = 0; left < landmarks.length; left += 1) for (let right = left + 1; right < landmarks.length; right += 1) {
    const distance = Math.hypot(landmarks[left].x - landmarks[right].x, landmarks[left].y - landmarks[right].y);
    check(distance + 0.00001 >= recipe.ecology.minLandmarkSpacingTiles, `landmarks ${landmarks[left].id} and ${landmarks[right].id} violate minimum spacing`, failures);
  }

  check(patch?.schemaVersion === "duskfell-terrain-detail-authority-v1", "terrain detail authority patch schema is invalid", failures);
  check(patch?.projection === "military-plan-oblique" && patch?.profile === "duskfell-terrain-v1", "terrain detail authority patch projection is invalid", failures);
  check(patch?.seed === recipe.seed && patch?.unitsPerTile === unitsPerTile, "terrain detail authority patch recipe identity is invalid", failures);
  check(patch?.sourceWorld?.sourceBundleSha256 === bundle.contentSha256, "terrain detail authority patch source hash does not match bundle content", failures);
  check(patch?.activation?.startsWith("review-only"), "terrain detail authority patch is not explicitly review-only", failures);
  check(patch?.counts?.resourceNodes === nodes.length && patch?.resourceNodes?.length === nodes.length, "terrain detail resource count does not match ecology authority", failures);
  const runtimeById = new Map((patch?.resourceNodes ?? []).map((node) => [node.id, node]));
  for (const node of nodes) {
    const runtime = runtimeById.get(node.id);
    check(Boolean(runtime), `resource node ${node.id} is missing from terrain detail authority`, failures);
    if (!runtime) continue;
    check(Math.abs(runtime.x - (recipe.placement.offsetX + node.x) * unitsPerTile) < 0.001, `resource node ${node.id} runtime x placement is invalid`, failures);
    check(Math.abs(runtime.y - (recipe.placement.offsetY + node.y) * unitsPerTile) < 0.001, `resource node ${node.id} runtime y placement is invalid`, failures);
    check(runtime.resources?.[0]?.kind === node.resource.toLowerCase() && runtime.resources?.[0]?.amount === node.amount && runtime.resources?.[0]?.maxAmount === node.maxAmount, `resource node ${node.id} runtime inventory drifts from ecology authority`, failures);
    check(JSON.stringify(runtime.lifecycle) === JSON.stringify(node.lifecycle), `resource node ${node.id} runtime lifecycle drifts from ecology authority`, failures);
  }
  check(patch?.counts?.decayConsumers === patch?.decayConsumers?.length, "terrain detail decay consumer count is invalid", failures);
  for (const consumer of patch?.decayConsumers ?? []) {
    check(nodeIds.has(consumer?.id), `decay consumer ${consumer?.id ?? "unknown"} has no ecology resource node`, failures);
    check(consumer?.consumes?.[0]?.kind === "deadwood" && consumer.consumes[0].amount === 1, `decay consumer ${consumer?.id ?? "unknown"} does not use the server resource encoding`, failures);
  }

  return {
    habitatPatches: patches.length,
    resourceNodes: nodes.length,
    resourceKinds: new Set(nodes.map((node) => node.resource)).size,
    landmarks: landmarks.length,
    decayConsumers: patch?.decayConsumers?.length ?? 0,
  };
}

function validateIllustration(root, recipe, manifest, failures) {
  const illustration = manifest.illustration;
  const execution = recipe.illustration.execution ?? "regional-v1";
  check(illustration?.state === "accepted", "enabled illustration is not accepted", failures);
  check(illustration?.provider === recipe.illustration.provider, "illustration provider does not match recipe", failures);
  check(illustration?.model === recipe.illustration.model, "illustration model does not match recipe", failures);
  check(illustration?.execution === execution, "illustration execution does not match recipe", failures);
  check(illustration?.control?.renderer === recipe.illustration.controlRenderer, "illustration control renderer does not match recipe", failures);
  checkedFileReference(root, illustration?.control, "illustration control", failures);
  if (execution === "chunked-v1") {
    check(illustration?.control?.width === recipe.dimensions.cols * recipe.macro.gameplayPixelsPerTile, "chunk illustration control width is invalid", failures);
    check(illustration?.control?.height === recipe.dimensions.rows * recipe.macro.gameplayPixelsPerTile, "chunk illustration control height is invalid", failures);
    check(illustration?.control?.pixelsPerTile === recipe.macro.gameplayPixelsPerTile, "chunk illustration control resolution is invalid", failures);
  }
  if (illustration?.control?.metadata) {
    const controlMetadata = checkedJsonReference(root, illustration.control.metadata, illustration.control.metadataSha256, "illustration control metadata", failures);
    check(controlMetadata?.renderer === recipe.illustration.controlRenderer, "illustration control metadata renderer does not match recipe", failures);
    check(controlMetadata?.bundleSha256 === manifest.bundleSha256, "illustration control was rendered from a different bundle", failures);
    if (controlMetadata?.alignment) {
      const controlAlignment = checkedJsonReference(root, controlMetadata.alignment.path, controlMetadata.alignment.sha256, "illustration control alignment", failures);
      check(controlAlignment?.schema === "duskfell-illustrated-alignment-v2" && controlAlignment?.phase === "control-preflight" && controlAlignment?.accepted === true, "illustration control semantic preflight did not pass", failures);
    } else {
      failures.push("illustration control metadata is missing semantic preflight evidence");
    }
  }
  const request = checkedJsonReference(root, illustration?.request, illustration?.requestSha256, "illustration request", failures);
  check(request?.schema === "duskfell-illustration-request-v1", "illustration request schema is invalid", failures);
  check(request?.request?.model === recipe.illustration.model, "illustration request model does not match recipe", failures);
  check(request?.request?.promptVersion === recipe.illustration.promptVersion, "illustration prompt version does not match recipe", failures);
  check(request?.request?.sourceSha256 === illustration?.control?.sha256, "illustration request source does not match its recorded control", failures);
  check(request?.request?.execution === execution, "illustration request execution does not match recipe", failures);
  check(
    JSON.stringify(request?.request?.inputAssets ?? null) === JSON.stringify(recipe.illustration.inputAssets ?? null),
    "illustration request input assets do not match recipe provenance",
    failures,
  );
  if (execution === "chunked-v1") validateChunkIllustrationJobs(root, recipe, manifest, request, failures);
  else {
    check(!illustration?.chunkJobs, "regional illustration unexpectedly records chunk jobs", failures);
    check(!request?.request?.chunkJobs, "regional illustration request unexpectedly records chunk jobs", failures);
  }
  for (const [label, reference] of [
    ["illustration candidate", illustration?.candidate],
    ["illustration master", illustration?.master],
  ]) checkedFileReference(root, reference, label, failures);
  const raw = checkedJsonReference(root, illustration?.rawAlignment?.path, illustration?.rawAlignment?.sha256, "raw illustration alignment", failures);
  const restored = checkedJsonReference(root, illustration?.restoredAlignment?.path, illustration?.restoredAlignment?.sha256, "restored illustration alignment", failures);
  check(raw?.schema === "duskfell-illustrated-alignment-v2" && raw?.phase === "raw-candidate" && raw?.accepted === true, "raw illustration alignment did not pass", failures);
  check(restored?.schema === "duskfell-illustrated-alignment-v2" && restored?.phase === "authority-restored" && restored?.accepted === true, "restored illustration alignment did not pass", failures);
  for (const [name, reference] of Object.entries(illustration?.masks ?? {})) checkedFileReference(root, reference, `${name} authority mask`, failures);
  for (const required of ["water", "snow", "trail", "settlement"]) check(Boolean(illustration?.masks?.[required]), `illustration is missing ${required} authority mask`, failures);

  const masterPath = resolvePackagePath(root, illustration?.master?.path);
  if (fs.existsSync(masterPath)) for (const [name, raster] of Object.entries(manifest.rasters ?? {})) {
    const rasterPath = resolvePackagePath(root, raster.path);
    if (!fs.existsSync(rasterPath)) continue;
    const verificationPath = path.join(root, `.validation-${name}-${process.pid}.png`);
    try {
      execFileSync("magick", [masterPath, "-filter", "Lanczos", "-resize", `${raster.width}x${raster.height}!`, verificationPath]);
      const difference = execFileSync("magick", ["compare", "-metric", "AE", verificationPath, rasterPath, "null:"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      check(difference === "0" || difference === "", `${name} LOD is not derived exactly from the illustrated master`, failures);
    } catch (error) {
      const metric = String(error.stderr ?? "").trim();
      failures.push(`${name} LOD differs from illustrated master${metric ? ` (${metric})` : ""}`);
    } finally {
      fs.rmSync(verificationPath, { force: true });
    }
  }
}

function validateChunkIllustrationJobs(root, recipe, manifest, requestRecord, failures) {
  const reference = manifest.illustration?.chunkJobs;
  check(reference?.path === "chunk-illustration/index.json", "chunk illustration index path is invalid", failures);
  check(JSON.stringify(requestRecord?.request?.chunkJobs) === JSON.stringify(reference), "chunk illustration request index reference is invalid", failures);
  const indexPath = path.join(root, "chunk-illustration", "index.json");
  checkFile(indexPath, "chunk illustration index", failures);
  if (!fs.existsSync(indexPath)) return;
  check(reference?.sha256 === sha256(indexPath), "chunk illustration index hash does not match", failures);
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch (error) {
    failures.push(`chunk illustration index is malformed: ${error.message}`);
    return;
  }
  check(index.schema === "duskfell-chunk-illustration-index-v1" && index.execution === "chunked-v1", "chunk illustration index schema is invalid", failures);
  check(index.world === manifest.world, "chunk illustration index world is invalid", failures);
  check(index.provider === recipe.illustration.provider && index.model === recipe.illustration.model, "chunk illustration provider provenance is invalid", failures);
  check(index.sourceBundleContentSha256 === readJson(root, manifest.bundle, failures)?.contentSha256, "chunk illustration bundle provenance is invalid", failures);
  check(index.sourceControlIndex?.sha256 === manifest.chunkVisuals?.control?.index?.sha256, "chunk illustration control provenance is invalid", failures);
  check(index.promptVersion === recipe.illustration.promptVersion, "chunk illustration prompt version is invalid", failures);
  check(index.promptSha256 === hashBytes(Buffer.from(JSON.stringify(recipe.illustration.prompt))), "chunk illustration prompt hash is invalid", failures);
  check(index.jobs?.length === manifest.chunkIndex?.count, "chunk illustration job count is invalid", failures);
  check(manifest.illustration?.chunkJobCount === index.jobs?.length, "chunk illustration manifest job count is invalid", failures);
  check(requestRecord?.request?.chunkJobCount === index.jobs?.length, "chunk illustration request job count is invalid", failures);
  check(index.assembledCandidate?.path === manifest.illustration?.candidate?.path, "chunk illustration assembled candidate path is invalid", failures);
  check(index.assembledCandidate?.sha256 === manifest.illustration?.candidate?.sha256, "chunk illustration assembled candidate hash is invalid", failures);
  check(index.review?.path === "chunk-illustration/review.png", "chunk illustration review path is invalid", failures);
  const reviewPath = path.join(root, "chunk-illustration", "review.png");
  checkFile(reviewPath, "chunk illustration review", failures);
  if (fs.existsSync(reviewPath)) check(index.review?.sha256 === sha256(reviewPath), "chunk illustration review hash does not match", failures);

  const controlIndexPath = path.join(root, "chunks", "visual-controls", "index.json");
  let controls = null;
  try {
    controls = JSON.parse(fs.readFileSync(controlIndexPath, "utf8"));
  } catch (error) {
    failures.push(`chunk illustration control index is missing or malformed: ${error.message}`);
  }
  const controlById = new Map((controls?.entries ?? []).map((entry) => [entry.id, entry]));
  const ids = new Set();
  for (const jobReference of index.jobs ?? []) {
    const id = jobReference?.id;
    check(typeof id === "string" && /^\d+-\d+$/.test(id) && !ids.has(id), `chunk illustration job ${id ?? "unknown"} identity is invalid`, failures);
    ids.add(id);
    check(jobReference?.path === `chunk-illustration/jobs/chunk-${id}.json`, `chunk illustration job ${id} path is invalid`, failures);
    const jobPath = path.join(root, "chunk-illustration", "jobs", `chunk-${id}.json`);
    checkFile(jobPath, `chunk illustration job ${id}`, failures);
    if (!fs.existsSync(jobPath)) continue;
    check(jobReference.sha256 === sha256(jobPath), `chunk illustration job ${id} hash does not match`, failures);
    let job;
    try {
      job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
    } catch (error) {
      failures.push(`chunk illustration job ${id} is malformed: ${error.message}`);
      continue;
    }
    const control = controlById.get(id);
    check(job.schema === "duskfell-chunk-illustration-job-v1" && job.request?.chunk === id, `chunk illustration job ${id} schema is invalid`, failures);
    check(job.request?.world === manifest.world, `chunk illustration job ${id} world is invalid`, failures);
    check(job.request?.control?.path === control?.image?.path && job.request?.control?.sha256 === control?.image?.sha256, `chunk illustration job ${id} control provenance is invalid`, failures);
    check(job.request?.provider === recipe.illustration.provider && job.request?.model === recipe.illustration.model, `chunk illustration job ${id} model provenance is invalid`, failures);
    check(job.requestSha256 === hashBytes(Buffer.from(JSON.stringify(job.request))), `chunk illustration job ${id} request hash is invalid`, failures);
    check(JSON.stringify(jobReference.output) === JSON.stringify(job.output), `chunk illustration job ${id} output reference is invalid`, failures);
    check(job.output?.path === `chunk-illustration/candidates/chunk-${id}.png`, `chunk illustration candidate ${id} path is invalid`, failures);
    const outputPath = path.join(root, "chunk-illustration", "candidates", `chunk-${id}.png`);
    checkFile(outputPath, `chunk illustration candidate ${id}`, failures);
    if (!fs.existsSync(outputPath)) continue;
    check(job.output.sha256 === sha256(outputPath), `chunk illustration candidate ${id} hash does not match`, failures);
    check(job.output.bytes === fs.statSync(outputPath).size, `chunk illustration candidate ${id} byte count does not match`, failures);
    const dimensions = pngDimensions(outputPath);
    check(dimensions.width === control?.image?.width && dimensions.height === control?.image?.height, `chunk illustration candidate ${id} dimensions are invalid`, failures);
  }
}

function checkedJsonReference(root, recordedPath, expectedHash, label, failures) {
  const filePath = resolvePackagePath(root, recordedPath);
  checkFile(filePath, label, failures);
  if (!fs.existsSync(filePath)) return null;
  check(expectedHash === sha256(filePath), `${label} hash does not match`, failures);
  return readJson(root, path.basename(filePath), failures);
}

function checkedFileReference(root, reference, label, failures) {
  const filePath = resolvePackagePath(root, reference?.path);
  checkFile(filePath, label, failures);
  if (fs.existsSync(filePath)) check(reference?.sha256 === sha256(filePath), `${label} hash does not match`, failures);
}

function finish(root, recipe, failures, metrics, writeReport) {
  const report = {
    schema: "duskfell-world-package-validation-v1",
    world: recipe.id,
    accepted: failures.length === 0,
    failures,
    metrics,
  };
  if (writeReport) fs.writeFileSync(path.join(root, "validation-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length > 0) throw new Error(`world package validation failed:\n- ${failures.join("\n- ")}`);
  return report;
}

function readJson(root, name, failures) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
  } catch (error) {
    failures.push(`${name} is missing or malformed: ${error.message}`);
    return null;
  }
}

function checkGrid(value, rows, cols, label, failures, { bounded = true } = {}) {
  if (!Array.isArray(value) || value.length !== rows) {
    failures.push(`${label} must contain ${rows} rows`);
    return;
  }
  for (let y = 0; y < rows; y += 1) {
    if (!Array.isArray(value[y]) || value[y].length !== cols) {
      failures.push(`${label}[${y}] must contain ${cols} values`);
      continue;
    }
    for (const sample of value[y]) {
      if (!Number.isFinite(sample) || (bounded && (sample < 0 || sample > 1))) {
        failures.push(`${label} contains an invalid sample`);
        return;
      }
    }
  }
}

function resolvePackagePath(root, recordedPath) {
  if (typeof recordedPath !== "string") return path.join(root, ".missing");
  const basename = path.basename(recordedPath);
  return path.join(root, basename);
}

function checkFile(filePath, label, failures) {
  check(fs.existsSync(filePath) && fs.statSync(filePath).isFile(), `${label} is missing`, failures);
}

function pngDimensions(filePath) {
  const header = fs.readFileSync(filePath).subarray(0, 24);
  if (header.length < 24 || header.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new Error(`${filePath} is not a PNG`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function check(condition, message, failures) {
  if (!condition) failures.push(message);
}
