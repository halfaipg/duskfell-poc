import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { buildRegionIndex, generateContinentAtlas, isKnownAtlasZone, readAtlasRecipe } from "./continent-atlas.mjs";

export function validateAtlasPackage(packageDir, { writeReport = true } = {}) {
  const root = path.resolve(packageDir);
  const failures = [];
  const recipePath = path.join(root, "recipe.json");
  const atlasPath = path.join(root, "atlas.json");
  const indexPath = path.join(root, "regions", "index.json");
  const manifestPath = path.join(root, "manifest.json");
  for (const [label, file] of [["recipe", recipePath], ["atlas", atlasPath], ["region index", indexPath], ["manifest", manifestPath]]) {
    check(fs.existsSync(file) && fs.statSync(file).isFile(), `${label} is missing`, failures);
  }
  if (failures.length) return finish(root, failures, {}, writeReport);
  let recipe;
  let atlas;
  let index;
  let manifest;
  try {
    recipe = readAtlasRecipe(recipePath);
    atlas = JSON.parse(fs.readFileSync(atlasPath, "utf8"));
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    failures.push(`atlas package JSON is invalid: ${error.message}`);
    return finish(root, failures, {}, writeReport);
  }
  const expectedAtlas = generateContinentAtlas(recipe);
  const expectedIndex = buildRegionIndex(expectedAtlas);
  check(atlas.schema === expectedAtlas.schema, "atlas schema is invalid", failures);
  check(atlas.contentSha256 === expectedAtlas.contentSha256, "atlas deterministic content hash does not match recipe", failures);
  check(JSON.stringify(atlas) === JSON.stringify(expectedAtlas), "atlas authority drifts from deterministic generation", failures);
  check(index.schema === expectedIndex.schema, "region index schema is invalid", failures);
  check(index.atlasContentSha256 === atlas.contentSha256, "region index parent hash is invalid", failures);
  check(JSON.stringify(index) === JSON.stringify(expectedIndex), "region index drifts from deterministic atlas authority", failures);
  check(manifest.schema === "duskfell-continent-atlas-manifest-v1", "atlas manifest schema is invalid", failures);
  check(manifest.state === "review", "atlas manifest must remain review-state", failures);
  check(manifest.recipe?.path === "recipe.json" && manifest.recipe?.sha256 === sha256(recipePath), "atlas recipe hash is invalid", failures);
  check(manifest.authority?.path === "atlas.json" && manifest.authority?.sha256 === sha256(atlasPath), "atlas authority file hash is invalid", failures);
  check(manifest.authority?.contentSha256 === atlas.contentSha256, "atlas manifest content hash is invalid", failures);
  check(manifest.regionIndex?.path === "regions/index.json" && manifest.regionIndex?.sha256 === sha256(indexPath), "atlas region-index hash is invalid", failures);
  check(manifest.regionIndex?.count === index.regionCount, "atlas region count is invalid", failures);
  check(manifest.runtimeStatus?.includes("not implemented"), "atlas manifest must disclose runtime paging status", failures);
  const sampleRows = atlas.sampling?.rows;
  const sampleCols = atlas.sampling?.cols;
  for (const required of ["elevation", "temperature", "precipitation", "humidity", "windExposure", "riverPotential"]) {
    check(Object.hasOwn(atlas.fields ?? {}, required), `atlas field ${required} is missing`, failures);
  }
  for (const [name, values] of Object.entries(atlas.fields ?? {})) {
    const bounded = name !== "erosionDelta";
    check(Array.isArray(values) && values.length === sampleRows && values.every((row) => Array.isArray(row) && row.length === sampleCols && row.every((value) => Number.isFinite(value) && (!bounded || (value >= 0 && value <= 1)))), `atlas field ${name} is invalid`, failures);
  }
  check(atlas.erosion?.schema === "duskfell-erosion-authority-v1" && atlas.erosion?.deterministic === true, "atlas erosion authority is invalid", failures);
  check(atlas.climateZones?.rows?.length === sampleRows, "atlas climate-zone row count is invalid", failures);
  check((atlas.climateZones?.rows ?? []).every((row) => typeof row === "string" && row.length === sampleCols && [...row].every(isKnownAtlasZone)), "atlas climate-zone rows are invalid", failures);
  check(atlas.drainage?.schema === "duskfell-continent-drainage-v1", "atlas drainage schema is invalid", failures);
  check(atlas.drainage?.algorithm === "priority-flood-d8-precipitation-runoff-v1", "atlas drainage algorithm is invalid", failures);
  check(atlas.drainage?.cols === sampleCols && atlas.drainage?.rows === sampleRows, "atlas drainage dimensions are invalid", failures);
  check(Number.isFinite(atlas.drainage?.runoffThreshold) && atlas.drainage.runoffThreshold > 0, "atlas drainage runoff threshold is invalid", failures);
  check(Number.isFinite(atlas.drainage?.runoffFull) && atlas.drainage.runoffFull > atlas.drainage.runoffThreshold, "atlas drainage full-runoff threshold is invalid", failures);
  check(Number.isFinite(atlas.drainage?.gateThreshold) && atlas.drainage.gateThreshold > 0 && atlas.drainage.gateThreshold < 1, "atlas drainage gate threshold is invalid", failures);
  check(Number.isInteger(atlas.drainage?.outlets) && atlas.drainage.outlets > 0, "atlas drainage has no outlets", failures);
  check(matrixIs(atlas.drainage?.flowDirectionD8, sampleRows, sampleCols, (value) => Number.isInteger(value) && value >= -1 && value <= 7), "atlas drainage directions are invalid", failures);
  check(matrixIs(atlas.drainage?.flowAccumulation, sampleRows, sampleCols, (value) => Number.isFinite(value) && value >= 0), "atlas drainage accumulation is invalid", failures);
  const riverSegments = atlas.drainage?.riverSegments ?? [];
  const riverSegmentIds = new Set();
  check(Array.isArray(riverSegments) && riverSegments.length >= 24, "atlas drainage has too few river segments", failures);
  for (const segment of riverSegments) {
    check(typeof segment.id === "string" && !riverSegmentIds.has(segment.id), "atlas river segment id is invalid or duplicated", failures);
    riverSegmentIds.add(segment.id);
    for (const [label, point] of [["from", segment.from], ["to", segment.to]]) {
      check(Number.isFinite(point?.x) && point.x >= 0 && point.x <= atlas.dimensions.worldTiles.cols && Number.isFinite(point?.y) && point.y >= 0 && point.y <= atlas.dimensions.worldTiles.rows, `atlas river segment ${segment.id} ${label} is invalid`, failures);
    }
    check(Number.isFinite(segment.potential) && segment.potential >= atlas.drainage.gateThreshold && segment.potential <= 1, `atlas river segment ${segment.id} potential is invalid`, failures);
    check(Number.isFinite(segment.widthTiles) && segment.widthTiles >= 1 && segment.widthTiles <= 16, `atlas river segment ${segment.id} width is invalid`, failures);
    check(Math.hypot(segment.to?.x - segment.from?.x, segment.to?.y - segment.from?.y) > 0, `atlas river segment ${segment.id} has zero length`, failures);
    check(Array.isArray(segment.points) && segment.points.length === 9, `atlas river segment ${segment.id} curve is invalid`, failures);
    check(JSON.stringify(segment.points?.[0]) === JSON.stringify(segment.from) && JSON.stringify(segment.points?.at(-1)) === JSON.stringify(segment.to), `atlas river segment ${segment.id} curve endpoints drift`, failures);
    for (const point of segment.points ?? []) {
      check(Number.isFinite(point?.x) && point.x >= 0 && point.x <= atlas.dimensions.worldTiles.cols && Number.isFinite(point?.y) && point.y >= 0 && point.y <= atlas.dimensions.worldTiles.rows, `atlas river segment ${segment.id} curve leaves world bounds`, failures);
    }
  }
  const coords = new Set();
  const regionsByCoord = new Map();
  let drainageGateCount = 0;
  for (const region of index.regions ?? []) {
    const key = `${region.coord?.x},${region.coord?.y}`;
    check(!coords.has(key), `duplicate region coordinate ${key}`, failures);
    coords.add(key);
    regionsByCoord.set(key, region);
    const copy = structuredClone(region);
    delete copy.descriptorSha256;
    check(region.descriptorSha256 === hashJson(copy), `region ${region.id} descriptor hash is invalid`, failures);
    check(region.drainageGates?.threshold === atlas.drainage?.gateThreshold, `region ${region.id} drainage gate threshold is invalid`, failures);
    for (const side of ["north", "east", "south", "west"]) {
      check(Array.isArray(region.drainageGates?.[side]), `region ${region.id} ${side} drainage gates are invalid`, failures);
      for (const gate of region.drainageGates?.[side] ?? []) {
        check(typeof gate.id === "string" && gate.id.length > 0, `region ${region.id} ${side} drainage gate id is invalid`, failures);
        check(Number.isFinite(gate.offset) && gate.offset >= 0 && gate.offset <= 1, `region ${region.id} ${side} drainage gate offset is invalid`, failures);
        check(Number.isFinite(gate.potential) && gate.potential >= atlas.drainage.gateThreshold && gate.potential <= 1, `region ${region.id} ${side} drainage gate potential is invalid`, failures);
        check(Number.isFinite(gate.width) && gate.width > 0 && gate.width <= 1.1, `region ${region.id} ${side} drainage gate width is invalid`, failures);
        drainageGateCount += 1;
      }
    }
  }
  check(coords.size === recipe.dimensions.regionCols * recipe.dimensions.regionRows, "region coordinates do not cover the atlas exactly once", failures);
  for (const region of index.regions ?? []) {
    const east = regionsByCoord.get(`${region.coord.x + 1},${region.coord.y}`);
    const south = regionsByCoord.get(`${region.coord.x},${region.coord.y + 1}`);
    if (east) check(JSON.stringify(region.drainageGates.east) === JSON.stringify(east.drainageGates.west), `region ${region.id} east drainage gates are not reciprocal`, failures);
    if (south) check(JSON.stringify(region.drainageGates.south) === JSON.stringify(south.drainageGates.north), `region ${region.id} south drainage gates are not reciprocal`, failures);
  }
  for (const [name, raster] of Object.entries(manifest.rasters ?? {})) {
    check(raster.path === path.basename(raster.path ?? ""), `atlas raster ${name} path is unsafe`, failures);
    const file = path.join(root, raster.path ?? ".missing");
    check(fs.existsSync(file), `atlas raster ${name} is missing`, failures);
    if (!fs.existsSync(file)) continue;
    check(raster.sha256 === sha256(file), `atlas raster ${name} hash is invalid`, failures);
    if (name !== "reviewSheet") {
      const [width, height] = execFileSync("magick", ["identify", "-format", "%w %h", file], { encoding: "utf8" }).trim().split(/\s+/).map(Number);
      check(width === raster.width && height === raster.height, `atlas raster ${name} dimensions are invalid`, failures);
    }
  }
  const zoneCodes = atlas.climateZones.rows.join("");
  const zoneCounts = Object.fromEntries([...new Set(zoneCodes)].sort().map((code) => [code, [...zoneCodes].filter((value) => value === code).length]));
  const zoneCount = Object.keys(zoneCounts).length;
  const landSamples = atlas.fields.elevation.flat().filter((value) => value > recipe.climate.seaLevel).length;
  const totalSamples = sampleCols * sampleRows;
  const landFraction = landSamples / totalSamples;
  const riverSamples = atlas.fields.riverPotential.flat().filter((value) => value >= atlas.drainage.gateThreshold).length;
  check(zoneCount >= 7, `continent atlas has only ${zoneCount} climate zones`, failures);
  check((zoneCounts.O ?? 0) > 0, "continent atlas has no open water", failures);
  check((zoneCounts.A ?? 0) > 0, "continent atlas has no alpine authority", failures);
  check((zoneCounts.C ?? 0) > 0, "continent atlas has no crag authority", failures);
  check((zoneCounts.B ?? 0) + (zoneCounts.F ?? 0) + (zoneCounts.Q ?? 0) > 0, "continent atlas has no woodland authority", failures);
  check((zoneCounts.G ?? 0) + (zoneCounts.H ?? 0) + (zoneCounts.S ?? 0) > 0, "continent atlas has no dry or open-country authority", failures);
  check(landFraction >= 0.25 && landFraction <= 0.7, `continent land fraction ${landFraction.toFixed(4)} is outside 0.25..0.7`, failures);
  check(riverSamples >= 24, `continent atlas has only ${riverSamples} major drainage samples`, failures);
  check(drainageGateCount >= 8, `continent atlas has only ${drainageGateCount} regional drainage gates`, failures);
  const metrics = {
    regions: index.regionCount,
    totalWorldTiles: atlas.dimensions.worldTiles.cols * atlas.dimensions.worldTiles.rows,
    totalGameplayChunks: index.totalGameplayChunks,
    coarseSamples: totalSamples,
    landSamples,
    landFraction: Number(landFraction.toFixed(4)),
    riverSamples,
    drainageGateCount,
    drainageOutlets: atlas.drainage.outlets,
    riverSegments: riverSegments.length,
    climateZones: zoneCount,
    zoneCounts,
    elevationRange: {
      min: Math.min(...atlas.fields.elevation.flat()),
      max: Math.max(...atlas.fields.elevation.flat()),
    },
  };
  return finish(root, failures, metrics, writeReport);
}

function matrixIs(values, rows, cols, predicate) {
  return Array.isArray(values) && values.length === rows
    && values.every((row) => Array.isArray(row) && row.length === cols && row.every(predicate));
}

function finish(root, failures, metrics, writeReport) {
  const report = { schema: "duskfell-continent-atlas-validation-v1", accepted: failures.length === 0, failures, metrics };
  if (writeReport) fs.writeFileSync(path.join(root, "validation-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length) throw new Error(`continent atlas validation failed: ${failures.join("; ")}`);
  return report;
}

function check(condition, message, failures) {
  if (!condition) failures.push(message);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
