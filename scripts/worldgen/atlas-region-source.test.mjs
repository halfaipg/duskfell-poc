import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { atlasRegionSourceMetadata, buildAtlasRegionSource, deriveAtlasRegionRecipe, generateAtlasRegionWorld, loadAtlasRegionContext } from "./atlas-region-source.mjs";
import { reconstructSourceTerrain } from "./apply-authoring.mjs";
import { readAtlasRecipe, writeAtlasPackage } from "./continent-atlas.mjs";
import { parseRegionArgs } from "./region-cli.mjs";
import { readRecipe } from "./recipe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("neighboring atlas regions share exact sampled elevation boundaries", () => {
  const atlasDir = path.join(ROOT, "var", `atlas-region-test-${process.pid}`);
  fs.rmSync(atlasDir, { recursive: true, force: true });
  try {
    const atlasRecipe = readAtlasRecipe(path.join(ROOT, "worlds/atlases/duskfell-continent.json"));
    atlasRecipe.id = "atlas-region-test";
    atlasRecipe.review.maxLongEdge = 512;
    writeAtlasPackage(atlasRecipe, atlasDir);
    const westContext = loadAtlasRegionContext(atlasDir, { x: 12, y: 9 });
    const eastContext = loadAtlasRegionContext(atlasDir, { x: 13, y: 9 });
    const template = readRecipe(path.join(ROOT, "worlds/recipes/duskfell-valley.json"));
    const westRecipe = deriveAtlasRegionRecipe(template, westContext);
    const eastRecipe = deriveAtlasRegionRecipe(template, eastContext);
    const westSource = buildAtlasRegionSource(westRecipe, westContext);
    const westRepeat = buildAtlasRegionSource(westRecipe, westContext);
    const eastSource = buildAtlasRegionSource(eastRecipe, eastContext);
    assert.equal(westSource.sha256, westRepeat.sha256);
    assert.notEqual(westSource.sha256, eastSource.sha256);
    const apron = westRecipe.macro.apronTiles * westRecipe.source.samplesPerTile;
    const westBoundaryX = apron + westRecipe.dimensions.cols * westRecipe.source.samplesPerTile;
    const eastBoundaryX = apron;
    for (let y = 0; y <= westRecipe.dimensions.rows * westRecipe.source.samplesPerTile; y += 1) {
      assert.equal(
        westSource.elevation[(apron + y) * westSource.width + westBoundaryX],
        eastSource.elevation[(apron + y) * eastSource.width + eastBoundaryX],
      );
    }
    const west = generateAtlasRegionWorld(westRecipe, westSource, westContext);
    const east = generateAtlasRegionWorld(eastRecipe, eastSource, eastContext);
    assert.equal(west.generation.algorithm, "atlas-region-refinement-v1");
    assert.equal(west.generation.source.atlas.contentSha256, westContext.atlas.contentSha256);
    assert.deepEqual(west.generation.source.neighbors, westContext.descriptor.neighbors);
    for (let y = 0; y <= westRecipe.dimensions.rows; y += 1) {
      assert.equal(west.heights[y][westRecipe.dimensions.cols], east.heights[y][0]);
    }
    const replayDir = path.join(atlasDir, "replay-source");
    fs.mkdirSync(replayDir);
    fs.writeFileSync(path.join(replayDir, "source-atlas-region.bin"), westSource.raw);
    fs.writeFileSync(path.join(replayDir, "source-atlas-region.json"), `${JSON.stringify(atlasRegionSourceMetadata(westRecipe, westSource, westContext))}\n`);
    fs.writeFileSync(path.join(replayDir, "manifest.json"), `${JSON.stringify({
      sourceArtifact: { path: "source-atlas-region.bin", metadata: "source-atlas-region.json", sha256: westSource.sha256 },
    })}\n`);
    const replayRecipe = structuredClone(westRecipe);
    replayRecipe.id = "atlas-region-replay";
    const replayed = reconstructSourceTerrain(replayRecipe, replayDir, [], west);
    assert.equal(replayed.id, replayRecipe.id);
    assert.deepEqual(replayed.authority, west.authority);
    assert.equal(replayed.generation.source.hydrologyStatus, west.generation.source.hydrologyStatus);
    const terrainOperations = [{
      field: "rockiness",
      mode: "raise",
      radius: 4,
      strength: 0.12,
      points: [{ x: westRecipe.dimensions.cols / 2, y: westRecipe.dimensions.rows / 2 }],
    }];
    const edited = reconstructSourceTerrain(replayRecipe, replayDir, terrainOperations, west);
    const editedRepeat = reconstructSourceTerrain(replayRecipe, replayDir, terrainOperations, west);
    assert.equal(edited.contentSha256, editedRepeat.contentSha256);
    assert.notDeepEqual(edited.fields.rockiness, west.fields.rockiness);
    assert.equal(edited.generation.terrainAuthoring.operationCount, 1);
    assert.equal(edited.generation.terrainAuthoring.basePayloadSha256, westSource.sha256);
    assert.equal(edited.generation.source.payloadSha256, westSource.sha256);
    assert.equal(edited.generation.source.editedSourceSha256, edited.generation.terrainAuthoring.editedSourceSha256);
    const seamOperation = [{
      field: "elevation",
      mode: "raise",
      radius: 2,
      strength: 0.12,
      points: [{ x: westRecipe.macro.apronTiles + 1, y: westRecipe.dimensions.rows / 2 }],
    }];
    assert.throws(() => reconstructSourceTerrain(replayRecipe, replayDir, seamOperation, west), /protected .* seam apron/);
    const tampered = structuredClone(westRecipe);
    tampered.source.atlas.parentAuthoritySha256 = "0".repeat(64);
    assert.throws(() => buildAtlasRegionSource(tampered, westContext), /descriptor hashes/);
  } finally {
    fs.rmSync(atlasDir, { recursive: true, force: true });
  }
});

test("neighboring atlas regions inherit the same river crossing", () => {
  const atlasDir = path.join(ROOT, "var", `atlas-river-test-${process.pid}`);
  fs.rmSync(atlasDir, { recursive: true, force: true });
  try {
    const atlasRecipe = readAtlasRecipe(path.join(ROOT, "worlds/atlases/duskfell-continent.json"));
    atlasRecipe.id = "atlas-river-test";
    atlasRecipe.review.maxLongEdge = 512;
    writeAtlasPackage(atlasRecipe, atlasDir);
    const initial = loadAtlasRegionContext(atlasDir, { x: 0, y: 0 });
    const candidates = initial.regionIndex.regions
      .filter((region) => region.neighbors.east && region.drainageGates.east.length > 0)
      .flatMap((region) => region.drainageGates.east.map((gate) => ({ region, gate })))
      .sort((left, right) => right.gate.potential - left.gate.potential);
    assert.ok(candidates.length > 0, "atlas must include an internal east-west river crossing");
    const { region, gate } = candidates[0];
    const westContext = loadAtlasRegionContext(atlasDir, region.coord);
    const eastContext = loadAtlasRegionContext(atlasDir, { x: region.coord.x + 1, y: region.coord.y });
    assert.deepEqual(westContext.descriptor.drainageGates.east, eastContext.descriptor.drainageGates.west);
    const template = readRecipe(path.join(ROOT, "worlds/recipes/duskfell-valley.json"));
    const westRecipe = deriveAtlasRegionRecipe(template, westContext);
    const eastRecipe = deriveAtlasRegionRecipe(template, eastContext);
    const westSource = buildAtlasRegionSource(westRecipe, westContext);
    const eastSource = buildAtlasRegionSource(eastRecipe, eastContext);
    assert.equal(westSource.inheritedRiverChannel, 1);
    const apron = westRecipe.macro.apronTiles * westRecipe.source.samplesPerTile;
    const westBoundaryX = apron + westRecipe.dimensions.cols * westRecipe.source.samplesPerTile;
    const eastBoundaryX = apron;
    for (let y = 0; y <= westRecipe.dimensions.rows * westRecipe.source.samplesPerTile; y += 1) {
      assert.equal(
        westSource.climate[1][(apron + y) * westSource.width + westBoundaryX],
        eastSource.climate[1][(apron + y) * eastSource.width + eastBoundaryX],
      );
    }
    const west = generateAtlasRegionWorld(westRecipe, westSource, westContext);
    const east = generateAtlasRegionWorld(eastRecipe, eastSource, eastContext);
    const crossingY = Math.round(gate.offset * (west.authority.cellRows - 1));
    const yStart = Math.max(0, crossingY - 8);
    const yEnd = Math.min(west.authority.cellRows - 1, crossingY + 8);
    let westPressure = 0;
    let eastPressure = 0;
    for (let y = yStart; y <= yEnd; y += 1) {
      westPressure = Math.max(westPressure, ...west.authority.river[y].slice(-4));
      eastPressure = Math.max(eastPressure, ...east.authority.river[y].slice(0, 4));
    }
    assert.ok(westPressure > 0.5, `west river pressure ${westPressure} does not reach the shared gate`);
    assert.ok(eastPressure > 0.5, `east river pressure ${eastPressure} does not reach the shared gate`);
  } finally {
    fs.rmSync(atlasDir, { recursive: true, force: true });
  }
});

test("atlas region CLI parser requires explicit bounded inputs", () => {
  assert.deepEqual(parseRegionArgs(["--atlas", "worlds/generated/atlas", "--coord", "12,9", "--output", "worlds/generated/region"]), {
    atlas: "worlds/generated/atlas",
    coord: "12,9",
    output: "worlds/generated/region",
  });
  assert.throws(() => parseRegionArgs(["--seed", "9"]), /unknown/);
  assert.throws(() => parseRegionArgs(["--coord"]), /requires a value/);
});
