import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildWorld, generateWorld } from "../worldgen-v2/world-pipeline.mjs";
import { validateWorldAuthoringPatch } from "../../client/world-editor-authoring.js";
import { parseAuthoringArgs } from "./apply-authoring.mjs";
import { composeWorldEcology } from "./ecology-composition.mjs";
import { parseArgs, run as runWorldgen } from "./cli.mjs";
import { illustrateWorldPackage, illustrationSize } from "./illustration.mjs";
import { renderChunkedIllustrationCandidate } from "./chunk-illustration.mjs";
import { validateWorldPackage } from "./package-validator.mjs";
import { applyRecipeOverrides, readRecipe, validateRecipe } from "./recipe.mjs";
import { applyTerrainOperationsToTerrainSource, generateTerrainDiffusionWorld, parseTerrainDiffusionPayload } from "./terrain-diffusion-source.mjs";
import { renderTexturedMaster } from "./texture-compositor.mjs";
import { applyAuthoredFeatures, planWorldFeatures } from "./world-planning.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RECIPE_PATH = path.join(ROOT, "worlds/recipes/duskfell-valley.json");
const TEXTURED_RECIPE_PATH = path.join(ROOT, "worlds/recipes/duskfell-textured-valley.json");

test("versioned example recipe is valid and deterministic", () => {
  const recipe = readRecipe(RECIPE_PATH);
  const first = generateWorld(recipe);
  const second = generateWorld(recipe);
  assert.equal(first.contentSha256, second.contentSha256);
  assert.equal(recipe.source.type, "synthetic-v2");
  assert.equal(recipe.placement.offsetX, 64);
});

test("climate ecology, resources, and landmarks are deterministic", () => {
  const recipe = readRecipe(RECIPE_PATH);
  const source = generateWorld(recipe);
  const planned = planWorldFeatures(source, recipe);
  const first = composeWorldEcology(planned, recipe);
  const second = composeWorldEcology(planned, recipe);
  assert.equal(first.contentSha256, second.contentSha256);
  assert.equal(first.ecology.schema, "duskfell-world-ecology-v1");
  assert.equal(first.ecology.landmarks.length, recipe.ecology.landmarkCount);
  assert.ok(first.ecology.resourceNodes.length > 0);
  assert.ok(new Set(first.ecology.resourceNodes.map((node) => node.resource)).size >= 2);
});

test("synthetic terrain operations deterministically rebuild hydrology and climate", () => {
  const recipe = readRecipe(RECIPE_PATH);
  const terrainOperations = [{ field: "elevation", mode: "raise", radius: 4, strength: 0.18, points: [{ x: 18.5, y: 26.5 }] }];
  const baseline = generateWorld(recipe);
  const first = generateWorld(recipe, { terrainOperations });
  const second = generateWorld(recipe, { terrainOperations });
  assert.equal(first.contentSha256, second.contentSha256);
  assert.notEqual(first.contentSha256, baseline.contentSha256);
  assert.equal(first.generation.terrainAuthoring.operationCount, 1);
  assert.notDeepEqual(first.heights, baseline.heights);
  assert.equal(first.climate.schema, "duskfell-climate-authority-v1");
  assert.equal(first.hydrology.authority.schema, "duskfell-hydrology-authority-v1");
});

test("recipe overrides resize controls and preserve bounded placement", () => {
  const recipe = applyRecipeOverrides(readRecipe(RECIPE_PATH), { id: "wide-proof", seed: "77", size: "192x128" });
  assert.deepEqual(recipe.dimensions, { cols: 192, rows: 128, unitsPerTile: 64 });
  assert.deepEqual(recipe.placement, { targetCols: 192, targetRows: 128, offsetX: 0, offsetY: 0 });
  assert.equal(recipe.terrain.valleyCenterX, 95.5);
});

test("Terrain Diffusion model alias selects its canonical source preset", () => {
  const recipe = applyRecipeOverrides(readRecipe(RECIPE_PATH), {
    seed: "74291",
    size: "192x128",
    model: "terrain-diffusion-30m",
  });
  assert.equal(recipe.source.type, "terrain-diffusion");
  assert.equal(recipe.source.repository, "https://github.com/xandergos/terrain-diffusion");
  assert.equal(recipe.source.license, "MIT");
  assert.equal(recipe.source.model, "xandergos/terrain-diffusion-30m");
  assert.deepEqual(recipe.source.region, { i: 768, j: 768 });
  assert.equal(recipe.source.scale, 2);
  assert.equal(recipe.source.samplesPerTile, 2);
  assert.deepEqual(recipe.dimensions, { cols: 192, rows: 128, unitsPerTile: 64 });
});

test("recipe validation refuses source/model mislabeling and unsafe dimensions", () => {
  const recipe = readRecipe(RECIPE_PATH);
  assert.throws(() => validateRecipe({ ...recipe, source: { ...recipe.source, model: "terrain-diffusion-30m" } }), /synthetic-v2 recipes/);
  assert.throws(() => validateRecipe({ ...recipe, dimensions: { ...recipe.dimensions, unitsPerTile: 32 } }), /64-unit projection/);
  const diffusion = readRecipe(path.join(ROOT, "worlds/recipes/terrain-diffusion-frontier.json"));
  assert.throws(() => validateRecipe({ ...diffusion, source: { ...diffusion.source, scale: 3 } }), /one of 1, 2, 4, or 8/);
  const textured = readRecipe(TEXTURED_RECIPE_PATH);
  const missingAsset = structuredClone(textured);
  delete missingAsset.illustration.inputAssets.meadow;
  assert.throws(() => validateRecipe(missingAsset), /inputAssets.meadow is required/);
  const unsafeAsset = structuredClone(textured);
  unsafeAsset.illustration.inputAssets.meadow.path = "../borrowed.png";
  assert.throws(() => validateRecipe(unsafeAsset), /path is unsafe/);
});

test("CLI parser rejects unknown and missing arguments", () => {
  assert.deepEqual(parseArgs(["--seed", "12", "--size", "64x48", "--api", "http://127.0.0.1:18000", "--illustration", "off", "--resume", "on"]), {
    seed: "12",
    size: "64x48",
    api: "http://127.0.0.1:18000",
    illustration: "off",
    resume: "on",
  });
  assert.throws(() => parseArgs(["--force"]), /unknown/);
  assert.throws(() => parseArgs(["--output"]), /requires a value/);
  assert.throws(() => applyRecipeOverrides(readRecipe(RECIPE_PATH), { illustration: "maybe" }), /on or off/);
  assert.deepEqual(parseAuthoringArgs(["--source", "source", "--patch", "patch.json", "--id", "edited-world"]), {
    source: "source",
    patch: "patch.json",
    id: "edited-world",
  });
  assert.throws(() => parseAuthoringArgs(["--force"]), /unknown/);
});

test("authored features deterministically rebuild planning authority", () => {
  const recipe = readRecipe(RECIPE_PATH);
  const source = generateWorld(recipe);
  const planned = planWorldFeatures(source, recipe);
  const replayed = applyAuthoredFeatures(source, recipe, planned.features);
  assert.equal(replayed.generation.planning.algorithm, "duskfell-authored-features-v1");
  assert.deepEqual(replayed.fields.settlement, planned.fields.settlement);
  assert.deepEqual(replayed.fields.trail, planned.fields.trail);
  assert.deepEqual(replayed.legacy.materialGrid, planned.legacy.materialGrid);
});

test("Terrain Diffusion payload parsing and world derivation are deterministic", () => {
  const base = readRecipe(path.join(ROOT, "worlds/recipes/terrain-diffusion-frontier.json"));
  const recipe = applyRecipeOverrides(base, { id: "terrain-fixture", size: "16x16" });
  const samples = recipe.source.samplesPerTile;
  const apronSamples = recipe.macro.apronTiles * samples;
  const width = recipe.dimensions.cols * samples + apronSamples * 2 + 1;
  const height = recipe.dimensions.rows * samples + apronSamples * 2 + 1;
  const cells = width * height;
  const raw = Buffer.alloc(cells * 18);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const valley = Math.abs(x - width * 0.5) * 12;
      raw.writeInt16LE(Math.round(800 + valley - y * 8), index * 2);
      const offset = cells * 2 + index * 16;
      raw.writeFloatLE(0.25 + y / height * 0.5, offset);
      raw.writeFloatLE(0, offset + 4);
      raw.writeFloatLE(0.2 + x / width * 0.65, offset + 8);
      raw.writeFloatLE(0, offset + 12);
    }
  }
  const source = parseTerrainDiffusionPayload(raw, width, height);
  const first = generateTerrainDiffusionWorld(recipe, source);
  const second = generateTerrainDiffusionWorld(recipe, source);
  assert.equal(first.contentSha256, second.contentSha256);
  assert.equal(first.generation.source.payloadSha256, source.sha256);
  assert.equal(first.legacy.materialGrid.length, recipe.dimensions.rows);
  assert.ok(first.legacy.materialGrid.every((row) => row.length === recipe.dimensions.cols && /^[0-9a-z]+$/i.test(row)));
  assert.ok(first.fields.temperature.flat().every(Number.isFinite));
  assert.equal(first.hydrology.authority.schema, "duskfell-hydrology-authority-v1");
  assert.ok(first.hydrology.authority.tributaries.length > 0 && first.hydrology.authority.tributaries.length <= recipe.hydrology.maxTributaries);
  assert.ok(first.hydrology.authority.shorelineSegments.length > 0);

  const terrainOperations = [
    { field: "elevation", mode: "raise", radius: 2, strength: 0.16, points: [{ x: 5.5, y: 5.5 }] },
    { field: "moisture", mode: "raise", radius: 2, strength: 0.2, points: [{ x: 10.5, y: 5.5 }] },
    { field: "rockiness", mode: "raise", radius: 2, strength: 0.22, points: [{ x: 5.5, y: 10.5 }] },
    { field: "riverSpline", mode: "route", radius: 1, strength: 1, points: [{ x: 8.5, y: 2.5 }, { x: 8.5, y: 13.5 }] },
  ];
  const editedSource = applyTerrainOperationsToTerrainSource(source, recipe, terrainOperations);
  const edited = generateTerrainDiffusionWorld(recipe, editedSource);
  const editedRepeat = generateTerrainDiffusionWorld(recipe, applyTerrainOperationsToTerrainSource(source, recipe, terrainOperations));
  assert.equal(edited.contentSha256, editedRepeat.contentSha256);
  assert.notDeepEqual(edited.authority.elevation, first.authority.elevation);
  assert.notDeepEqual(edited.fields.moisture, first.fields.moisture);
  assert.notDeepEqual(edited.fields.rockiness, first.fields.rockiness);
  assert.notDeepEqual(edited.authority.river, first.authority.river);
  assert.equal(edited.generation.terrainAuthoring.operationCount, terrainOperations.length);
  assert.equal(edited.generation.terrainAuthoring.basePayloadSha256, source.sha256);
});

test("recipe reader fails closed on malformed JSON", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "duskfell-worldgen-test-"));
  const recipePath = path.join(directory, "recipe.json");
  fs.writeFileSync(recipePath, "{ nope");
  assert.throws(() => readRecipe(recipePath), /unable to read world recipe/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("illustration stage repairs authority, derives LODs, and validates offline", async () => {
  const directory = fs.mkdtempSync(path.join(ROOT, "var", "worldgen-illustration-test-"));
  try {
    const recipe = applyRecipeOverrides(readRecipe(RECIPE_PATH), { id: "illustration-proof" });
    recipe.macro.gameplayPixelsPerTile = 8;
    recipe.macro.travelPixelsPerTile = 4;
    recipe.macro.worldMapPixelsPerTile = 2;
    recipe.illustration.enabled = true;
    recipe.illustration.execution = "regional-v1";
    recipe.illustration.maxLongEdge = 512;
    const recipePath = path.join(directory, "recipe.json");
    fs.writeFileSync(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);
    buildWorld(recipePath, { outputDir: directory });
    const providerImage = path.join(directory, ".provider.png");
    const size = illustrationSize(recipe.dimensions, recipe.illustration.maxLongEdge);
    const [width, height] = size.split("x").map(Number);
    const bundle = JSON.parse(fs.readFileSync(path.join(directory, "world-bundle-v2.json"), "utf8"));
    renderTexturedMaster(bundle, providerImage, { width, height, recipe: readRecipe(TEXTURED_RECIPE_PATH) });
    const b64 = fs.readFileSync(providerImage).toString("base64");
    fs.unlinkSync(providerImage);
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ created: 1, data: [{ b64_json: b64, seed: recipe.seed }], grid: { worker: "offline-test", model: recipe.illustration.model } }),
    });
    await illustrateWorldPackage(directory, recipe, { apiKey: "test-key", apiBase: "http://offline.invalid", fetchImpl });
    const report = validateWorldPackage(directory, { writeReport: false });
    assert.equal(report.accepted, true);
    assert.ok(fs.existsSync(path.join(directory, "illustrated-master.png")));
    assert.ok(fs.existsSync(path.join(directory, "authority-water-mask.png")));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("project-owned texture compositor produces a validated offline review package", async () => {
  const directory = fs.mkdtempSync(path.join(ROOT, "var", "worldgen-compositor-test-"));
  try {
    const recipe = applyRecipeOverrides(readRecipe(TEXTURED_RECIPE_PATH), { id: "compositor-proof" });
    recipe.macro.gameplayPixelsPerTile = 8;
    recipe.macro.travelPixelsPerTile = 4;
    recipe.macro.worldMapPixelsPerTile = 2;
    recipe.illustration.enabled = true;
    recipe.illustration.execution = "chunked-v1";
    recipe.illustration.maxLongEdge = 512;
    const recipePath = path.join(directory, "recipe.json");
    fs.writeFileSync(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);
    buildWorld(recipePath, { outputDir: directory });
    const bundle = JSON.parse(fs.readFileSync(path.join(directory, "world-bundle-v2.json"), "utf8"));
    const driftedRecipe = structuredClone(recipe);
    driftedRecipe.illustration.inputAssets.meadow.sha256 = "0".repeat(64);
    assert.throws(
      () => renderTexturedMaster(bundle, path.join(directory, "drifted.png"), { width: 512, height: 512, recipe: driftedRecipe }),
      /input meadow hash drifted/,
    );
    await illustrateWorldPackage(directory, recipe);
    const report = validateWorldPackage(directory, { writeReport: false });
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
    assert.equal(report.accepted, true);
    assert.equal(manifest.illustration.provider, "duskfell-authority-compositor");
    assert.equal(manifest.illustration.state, "accepted");
    assert.equal(manifest.illustration.execution, "chunked-v1");
    assert.equal(manifest.illustration.chunkJobCount, 4);
    assert.equal(manifest.chunkVisuals.illustrated.count, 4);
    assert.equal(manifest.chunkVisuals.illustrated.seamCount, 4);
    assert.equal(report.metrics.chunkVisualIllustratedSeams, 4);
    assert.ok(report.metrics.chunkVisualIllustratedBytes > 0);
    assert.ok(fs.existsSync(path.join(directory, "illustrated-master.png")));
    assert.ok(fs.existsSync(path.join(directory, manifest.chunkVisuals.illustrated.index.path)));
    assert.ok(fs.existsSync(path.join(directory, manifest.chunkVisuals.illustrated.review.path)));
    assert.ok(fs.existsSync(path.join(directory, manifest.illustration.chunkJobs.path)));
    assert.ok(fs.existsSync(path.join(directory, "chunk-illustration", "jobs", "chunk-0-0.json")));
    assert.ok(fs.existsSync(path.join(directory, "chunk-illustration", "review.png")));
    const request = JSON.parse(fs.readFileSync(path.join(directory, manifest.illustration.request), "utf8"));
    assert.equal(request.request.inputAssets.meadow.sha256, recipe.illustration.inputAssets.meadow.sha256);
    const resumed = await renderChunkedIllustrationCandidate({
      root: directory,
      bundle,
      recipe,
      manifest,
      candidatePath: path.join(directory, "illustrated-candidate.png"),
    });
    assert.equal(resumed.generated, 0);
    assert.equal(resumed.resumed, 4);
    assert.equal(resumed.index.sha256, manifest.illustration.chunkJobs.sha256);
    assert.equal(validateWorldPackage(directory, { writeReport: false }).accepted, true);

    request.request.inputAssets.meadow.sha256 = "0".repeat(64);
    request.requestSha256 = crypto.createHash("sha256").update(JSON.stringify(request.request)).digest("hex");
    const requestPath = path.join(directory, manifest.illustration.request);
    fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`);
    manifest.illustration.requestSha256 = crypto.createHash("sha256").update(fs.readFileSync(requestPath)).digest("hex");
    fs.writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(
      () => validateWorldPackage(directory, { writeReport: false }),
      /illustration request input assets do not match recipe provenance/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI builds and validates a quarantined review package", () => {
  const id = `worldgen-test-${process.pid}`;
  const relativeOutput = path.join("var", id);
  const output = path.join(ROOT, relativeOutput);
  fs.rmSync(output, { recursive: true, force: true });
  fs.rmSync(`${output}.building`, { recursive: true, force: true });
  fs.rmSync(`${output}.rejected`, { recursive: true, force: true });
  const stdout = execFileSync(process.execPath, [
    path.join(ROOT, "scripts/worldgen/cli.mjs"),
    "--id", id,
    "--size", "16x16",
    "--output", relativeOutput,
  ], { cwd: ROOT, encoding: "utf8" });
  const result = JSON.parse(stdout);
  const report = JSON.parse(fs.readFileSync(path.join(output, "validation-report.json"), "utf8"));
  assert.equal(result.validation, "accepted");
  assert.equal(result.activation, "review-only");
  assert.equal(report.accepted, true);
  assert.ok(fs.existsSync(path.join(output, "review-sheet.png")));
  assert.ok(fs.existsSync(path.join(output, "ecology-review.png")));
  assert.ok(fs.existsSync(path.join(output, "terrain-detail-authority-patch.json")));
  const manifest = JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.chunkIndex.count, 1);
  const chunkPath = path.join(output, "chunks", "chunk-0-0.json");
  const chunkRaw = fs.readFileSync(chunkPath, "utf8");
  const chunk = JSON.parse(chunkRaw);
  chunk.fields.humidity[0][0] = chunk.fields.humidity[0][0] > 0.5 ? 0.1 : 0.9;
  fs.writeFileSync(chunkPath, `${JSON.stringify(chunk)}\n`);
  assert.throws(() => validateWorldPackage(output, { writeReport: false }), /chunk 0-0 hash/);
  fs.writeFileSync(chunkPath, chunkRaw);
  const bundlePath = path.join(output, "world-bundle-v2.json");
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  assert.equal(bundle.ecology.schema, "duskfell-world-ecology-v1");
  bundle.hydrology.authority.shorelineSegments.pop();
  fs.writeFileSync(bundlePath, `${JSON.stringify(bundle)}\n`);
  assert.throws(() => validateWorldPackage(output, { writeReport: false }), /hydrology shoreline count/);
  bundle.fields.moisture[0][0] = bundle.fields.moisture[0][0] > 0.5 ? 0.1 : 0.9;
  fs.writeFileSync(bundlePath, `${JSON.stringify(bundle)}\n`);
  assert.throws(() => validateWorldPackage(output, { writeReport: false }), /deterministic content hash/);
  fs.rmSync(output, { recursive: true, force: true });
  fs.rmSync(`${output}.building`, { recursive: true, force: true });
  fs.rmSync(`${output}.rejected`, { recursive: true, force: true });
});

test("model-backed CLI fetches, pins, and validates the canonical source preset", async () => {
  const id = `worldgen-model-test-${process.pid}`;
  const relativeOutput = path.join("var", id);
  const output = path.join(ROOT, relativeOutput);
  for (const target of [output, `${output}.building`, `${output}.rejected`]) fs.rmSync(target, { recursive: true, force: true });
  let requestedUrl = null;
  const fetchImpl = async (url) => {
    requestedUrl = new URL(url);
    const width = Number(requestedUrl.searchParams.get("j2")) - Number(requestedUrl.searchParams.get("j1"));
    const height = Number(requestedUrl.searchParams.get("i2")) - Number(requestedUrl.searchParams.get("i1"));
    const raw = terrainDiffusionFixture(width, height);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "x-width": String(width), "x-height": String(height) }),
      arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    };
  };
  try {
    const writes = [];
    const result = await runWorldgen([
      "--id", id,
      "--seed", "74291",
      "--size", "16x16",
      "--model", "terrain-diffusion-30m",
      "--api", "http://terrain-fixture.invalid",
      "--output", relativeOutput,
    ], { fetchImpl, stdout: { write: (value) => writes.push(value) } });
    assert.equal(result.validation, "accepted");
    assert.equal(result.source.type, "terrain-diffusion");
    assert.equal(requestedUrl.pathname, "/terrain");
    assert.equal(requestedUrl.searchParams.get("scale"), "2");
    assert.equal(requestedUrl.searchParams.get("j2") - requestedUrl.searchParams.get("j1"), 49);
    assert.equal(requestedUrl.searchParams.get("i2") - requestedUrl.searchParams.get("i1"), 49);
    assert.equal(JSON.parse(writes.join("")).activation, "review-only");
    const recipe = JSON.parse(fs.readFileSync(path.join(output, "recipe.json"), "utf8"));
    const source = JSON.parse(fs.readFileSync(path.join(output, "source-terrain.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));
    assert.equal(recipe.source.model, "xandergos/terrain-diffusion-30m");
    assert.equal(source.sha256, manifest.sourceArtifact.sha256);
    assert.equal(source.width, 49);
    assert.equal(source.height, 49);
    assert.equal(validateWorldPackage(output, { writeReport: false }).accepted, true);
  } finally {
    for (const target of [output, `${output}.building`, `${output}.rejected`]) fs.rmSync(target, { recursive: true, force: true });
  }
});

test("chunk visual controls carry exact aprons and reject rehashed seam drift", () => {
  const directory = fs.mkdtempSync(path.join(ROOT, "var", "worldgen-chunk-visual-test-"));
  try {
    const recipe = applyRecipeOverrides(readRecipe(RECIPE_PATH), {
      id: "chunk-visual-test",
      size: "16x16",
    });
    recipe.macro.tiles = 8;
    recipe.macro.apronTiles = 2;
    recipe.macro.gameplayPixelsPerTile = 8;
    recipe.macro.travelPixelsPerTile = 4;
    recipe.macro.worldMapPixelsPerTile = 2;
    const recipePath = path.join(directory, "recipe.json");
    fs.writeFileSync(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);
    buildWorld(recipePath, { outputDir: directory });
    const report = validateWorldPackage(directory, { writeReport: false });
    const manifestPath = path.join(directory, "manifest.json");
    const visualIndexPath = path.join(directory, "chunks", "visual-controls", "index.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const visualIndex = JSON.parse(fs.readFileSync(visualIndexPath, "utf8"));
    assert.equal(manifest.schema, "duskfell-world-render-manifest-v4");
    assert.equal(visualIndex.entries.length, 4);
    assert.equal(visualIndex.seams.length, 4);
    assert.equal(report.metrics.chunkVisualSeams, 4);
    assert.ok(fs.existsSync(path.join(directory, manifest.chunkVisuals.control.review.path)));

    const seam = visualIndex.seams[0];
    const target = visualIndex.entries.find((entry) => entry.id === seam.b);
    const targetPath = path.join(directory, ...target.image.path.split("/"));
    execFileSync("magick", [
      targetPath,
      "-fill", "#ff00ff",
      "-draw", `point ${seam.bCrop.x},${seam.bCrop.y}`,
      targetPath,
    ]);
    target.image.sha256 = fileSha256(targetPath);
    target.image.bytes = fs.statSync(targetPath).size;
    fs.writeFileSync(visualIndexPath, `${JSON.stringify(visualIndex, null, 2)}\n`);
    manifest.chunkVisuals.control.index.sha256 = fileSha256(visualIndexPath);
    manifest.chunkVisuals.control.totalBytes = visualIndex.entries
      .reduce((sum, entry) => sum + entry.image.bytes, 0);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(
      () => validateWorldPackage(directory, { writeReport: false }),
      /chunk visual seam .* pixels drift/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function terrainDiffusionFixture(width, height) {
  const cells = width * height;
  const raw = Buffer.alloc(cells * 18);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const valley = Math.abs(x - width * 0.5) * 12;
      raw.writeInt16LE(Math.round(800 + valley - y * 8), index * 2);
      const offset = cells * 2 + index * 16;
      raw.writeFloatLE(0.25 + y / height * 0.5, offset);
      raw.writeFloatLE(0, offset + 4);
      raw.writeFloatLE(0.2 + x / width * 0.65, offset + 8);
      raw.writeFloatLE(0, offset + 12);
    }
  }
  return raw;
}

test("authoring CLI replays a hash-bound patch into a new validated package", () => {
  const sourceId = `worldgen-authoring-source-${process.pid}`;
  const editedId = `worldgen-authoring-edited-${process.pid}`;
  const sourceRelative = path.join("var", sourceId);
  const editedRelative = path.join("var", editedId);
  const sourceDir = path.join(ROOT, sourceRelative);
  const editedDir = path.join(ROOT, editedRelative);
  const patchPath = path.join(ROOT, "var", `${editedId}.json`);
  fs.rmSync(sourceDir, { recursive: true, force: true });
  fs.rmSync(editedDir, { recursive: true, force: true });
  try {
    execFileSync(process.execPath, [path.join(ROOT, "scripts/worldgen/cli.mjs"), "--id", sourceId, "--size", "16x16", "--output", sourceRelative], { cwd: ROOT });
    const bundle = JSON.parse(fs.readFileSync(path.join(sourceDir, "world-bundle-v2.json"), "utf8"));
    const recipe = readRecipe(path.join(sourceDir, "recipe.json"));
    const authoringPatch = {
      schema: "duskfell-world-authoring-patch-v1",
      source: {
        world: bundle.id,
        bundleContentSha256: bundle.contentSha256,
        dimensions: { cols: bundle.dimensions.cols, rows: bundle.dimensions.rows, unitsPerTile: bundle.dimensions.unitsPerTile },
      },
      features: {
        settlements: bundle.features.settlements,
        trails: bundle.features.trails,
        landmarks: bundle.ecology.landmarks,
      },
      terrain: {
        schema: "duskfell-terrain-authoring-v1",
        operations: [{ field: "elevation", mode: "raise", radius: 1, strength: 0.1, points: [{ x: 0.5, y: 0.5 }] }],
      },
    };
    validateWorldAuthoringPatch(authoringPatch, bundle, { maxSlope: recipe.planning.maxTrailSlope });
    fs.writeFileSync(patchPath, `${JSON.stringify(authoringPatch, null, 2)}\n`);
    const stdout = execFileSync(process.execPath, [
      path.join(ROOT, "scripts/worldgen/apply-authoring.mjs"),
      "--source", sourceRelative,
      "--patch", path.relative(ROOT, patchPath),
      "--id", editedId,
      "--output", editedRelative,
    ], { cwd: ROOT, encoding: "utf8" });
    const result = JSON.parse(stdout);
    const manifest = JSON.parse(fs.readFileSync(path.join(editedDir, "manifest.json"), "utf8"));
    const edited = JSON.parse(fs.readFileSync(path.join(editedDir, "world-bundle-v2.json"), "utf8"));
    assert.equal(result.validation, "accepted");
    assert.equal(result.terrainOperations, 1);
    assert.equal(manifest.authoring.sourceWorld, sourceId);
    assert.equal(edited.generation.planning.algorithm, "duskfell-authored-features-v1");
    assert.equal(edited.generation.terrainAuthoring.operationCount, 1);
    assert.equal(validateWorldPackage(editedDir, { writeReport: false }).accepted, true);
    const installedPatchPath = path.join(editedDir, "authoring-patch.json");
    const installedPatch = JSON.parse(fs.readFileSync(installedPatchPath, "utf8"));
    installedPatch.features.settlements[0].name = "Tampered Hold";
    fs.writeFileSync(installedPatchPath, `${JSON.stringify(installedPatch, null, 2)}\n`);
    assert.throws(() => validateWorldPackage(editedDir, { writeReport: false }), /authoring patch hash/);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(editedDir, { recursive: true, force: true });
    fs.rmSync(`${editedDir}.rejected`, { recursive: true, force: true });
    fs.rmSync(patchPath, { force: true });
  }
});
