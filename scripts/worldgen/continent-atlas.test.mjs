import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseAtlasArgs } from "./atlas-cli.mjs";
import { validateAtlasPackage } from "./atlas-validator.mjs";
import { buildRegionIndex, generateContinentAtlas, readAtlasRecipe, validateAtlasRecipe, writeAtlasPackage } from "./continent-atlas.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RECIPE_PATH = path.join(ROOT, "worlds/atlases/duskfell-continent.json");

test("continent atlas recipe deterministically addresses a huge world", () => {
  const recipe = readAtlasRecipe(RECIPE_PATH);
  const first = generateContinentAtlas(recipe);
  const second = generateContinentAtlas(recipe);
  assert.equal(first.contentSha256, second.contentSha256);
  assert.deepEqual(first.dimensions.worldTiles, { cols: 6144, rows: 3072 });
  const index = buildRegionIndex(first);
  assert.equal(index.regionCount, 768);
  assert.equal(index.totalGameplayChunks, 18432);
  assert.equal(new Set(index.regions.map((region) => region.seed)).size, index.regionCount);
  const center = index.regions.find((region) => region.coord.x === 12 && region.coord.y === 9);
  assert.equal(center.neighbors.east, `${first.id}-r13-9`);
  assert.equal(center.neighbors.south, `${first.id}-r12-10`);
  assert.notEqual(center.parentAuthoritySha256, index.regions.find((region) => region.coord.x === 13 && region.coord.y === 9).parentAuthoritySha256);
  const crossing = index.regions.find((region) => region.neighbors.east && region.drainageGates.east.length > 0);
  assert.ok(crossing, "atlas must expose at least one internal east-west drainage gate");
  const east = index.regions.find((region) => region.id === crossing.neighbors.east);
  assert.deepEqual(crossing.drainageGates.east, east.drainageGates.west);
  assert.ok(first.fields.riverPotential.flat().some((value) => value >= first.drainage.gateThreshold));
});

test("continent atlas validation rejects unsafe geometry and malformed arguments", () => {
  const recipe = readAtlasRecipe(RECIPE_PATH);
  assert.throws(() => validateAtlasRecipe({ ...recipe, dimensions: { ...recipe.dimensions, regionTiles: { cols: 190, rows: 128 } } }), /divisible/);
  assert.throws(() => validateAtlasRecipe({ ...recipe, source: { ...recipe.source, model: "unrecorded" } }), /source must/);
  assert.deepEqual(parseAtlasArgs(["--recipe", "recipe.json", "-o", "worlds/generated/test"]), { recipe: "recipe.json", output: "worlds/generated/test" });
  assert.throws(() => parseAtlasArgs(["--seed", "7"]), /unknown/);
});

test("continent atlas package is hash-pinned and fail-closed", () => {
  const directory = fs.mkdtempSync(path.join(ROOT, "var", "atlas-test-"));
  try {
    const recipe = readAtlasRecipe(RECIPE_PATH);
    recipe.id = "atlas-test";
    recipe.review.maxLongEdge = 512;
    writeAtlasPackage(recipe, directory);
    const report = validateAtlasPackage(directory);
    assert.equal(report.accepted, true);
    assert.equal(report.metrics.regions, 768);
    assert.equal(report.metrics.totalGameplayChunks, 18432);
    assert.ok(report.metrics.riverSamples >= 24);
    assert.ok(report.metrics.drainageGateCount >= 8);
    const indexPath = path.join(directory, "regions", "index.json");
    const original = fs.readFileSync(indexPath, "utf8");
    const index = JSON.parse(original);
    index.regions[0].seed += 1;
    fs.writeFileSync(indexPath, `${JSON.stringify(index)}\n`);
    assert.throws(() => validateAtlasPackage(directory, { writeReport: false }), /region index drifts|region.*hash/);
    fs.writeFileSync(indexPath, original);
    assert.equal(validateAtlasPackage(directory, { writeReport: false }).accepted, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
