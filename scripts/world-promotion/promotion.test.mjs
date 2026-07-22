import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildWorld } from "../worldgen-v2/world-pipeline.mjs";
import { validateWorldPackage } from "../worldgen/package-validator.mjs";
import { applyRecipeOverrides, readRecipe } from "../worldgen/recipe.mjs";
import { illustrateWorldPackage } from "../worldgen/illustration.mjs";
import { createVisualApprovalTemplate, promoteWorldPackage, resolvePromotedWorld, serverRegionRouting, stageWorldPackagePreview, visualApprovalStatement } from "./promotion.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RECIPE_PATH = path.join(ROOT, "worlds/recipes/duskfell-valley.json");
const TEXTURED_RECIPE_PATH = path.join(ROOT, "worlds/recipes/duskfell-textured-valley.json");

test("promotion is hash-bound, requires illustrated approval, and installs an isolated runtime world", () => {
  const root = path.join(ROOT, "var", `world-promotion-test-${process.pid}`);
  const packageDir = path.join(root, "package");
  const approvalsDir = path.join(root, "approvals");
  const runtimeWorldsDir = path.join(root, "runtime-worlds");
  const serverWorldsDir = path.join(root, "server-worlds");
  const registryPath = path.join(runtimeWorldsDir, "registry.json");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(packageDir, { recursive: true });
  try {
    const recipe = applyRecipeOverrides(readRecipe(RECIPE_PATH), { id: "promotion-proof", size: "16x16" });
    const recipePath = path.join(packageDir, "recipe.json");
    fs.writeFileSync(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);
    buildWorld(recipePath, { outputDir: packageDir });
    validateWorldPackage(packageDir);

    const previewRoot = path.join(root, "preview");
    const preview = stageWorldPackagePreview(packageDir, { previewRoot });
    const previewManifest = JSON.parse(fs.readFileSync(path.join(preview.runtimeDir, "runtime-manifest.json"), "utf8"));
    const previewRegistry = JSON.parse(fs.readFileSync(preview.registryPath, "utf8"));
    const previewAuthority = JSON.parse(fs.readFileSync(preview.terrainDetailAuthorityPath, "utf8"));
    assert.equal(previewManifest.state, "review");
    assert.equal(preview.manifest.state, "review");
    assert.equal(previewManifest.review.humanApproval, false);
    assert.equal(previewManifest.approval, undefined);
    assert.equal(previewRegistry.worlds[0].state, "review");
    assert.equal(previewAuthority.activation, "isolated-review-runtime");
    assert.ok(fs.existsSync(path.join(preview.assetsDir, "sprites/manifest.json")));
    assert.throws(() => resolvePromotedWorld("promotion-proof", {
      runtimeWorldsDir: path.join(preview.assetsDir, "terrain/worlds"),
      serverWorldsDir: path.join(preview.previewRoot, "server-worlds"),
      registryPath: preview.registryPath,
    }), /not approved/);
    assert.equal(stageWorldPackagePreview(packageDir, { previewRoot }).world, "promotion-proof");

    const approvalPath = path.join(approvalsDir, "promotion-proof.json");
    createVisualApprovalTemplate(packageDir, approvalPath);
    assert.throws(
      () => promoteWorldPackage(packageDir, approvalPath, { runtimeWorldsDir, serverWorldsDir, registryPath }),
      /accepted illustrated master/,
    );

    const approval = JSON.parse(fs.readFileSync(approvalPath, "utf8"));
    Object.assign(approval, {
      decision: "approved",
      approver: "offline promotion test",
      reviewedAt: "2026-07-20T12:00:00.000Z",
      cameraContractAccepted: true,
      artDirectionAccepted: true,
      authorityAlignmentAccepted: true,
      statement: visualApprovalStatement,
    });
    fs.writeFileSync(approvalPath, `${JSON.stringify(approval, null, 2)}\n`);
    const driftedApproval = { ...approval, packageManifestSha256: "0".repeat(64) };
    const driftedPath = path.join(approvalsDir, "drifted.json");
    fs.writeFileSync(driftedPath, `${JSON.stringify(driftedApproval, null, 2)}\n`);
    assert.throws(
      () => promoteWorldPackage(packageDir, driftedPath, { runtimeWorldsDir, serverWorldsDir, registryPath, requireIllustrated: false }),
      /manifest hash does not match/,
    );

    const result = promoteWorldPackage(packageDir, approvalPath, {
      runtimeWorldsDir,
      serverWorldsDir,
      registryPath,
      requireIllustrated: false,
    });
    const runtimeManifest = JSON.parse(fs.readFileSync(path.join(result.runtimeDir, "runtime-manifest.json"), "utf8"));
    const serverWorld = JSON.parse(fs.readFileSync(result.serverWorldPath, "utf8"));
    const detailAuthority = JSON.parse(fs.readFileSync(result.terrainDetailAuthorityPath, "utf8"));
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));

    assert.equal(runtimeManifest.state, "approved");
    assert.equal(runtimeManifest.serverContent.mode, "standalone-wipe");
    assert.equal(runtimeManifest.chunks.count, 1);
    assert.equal(runtimeManifest.chunks.index.path, "chunks/index.json");
    assert.equal(runtimeManifest.chunks.vertexHeightPrecision, 1000);
    assert.ok(runtimeManifest.chunks.totalBytes > 0);
    assert.ok(fs.existsSync(path.join(result.runtimeDir, "chunks", "chunk-0-0.json")));
    assert.equal(runtimeManifest.chunkVisuals.control.count, 1);
    assert.ok(fs.existsSync(path.join(result.runtimeDir, runtimeManifest.chunkVisuals.control.index.path)));
    assert.ok(fs.existsSync(path.join(result.runtimeDir, "chunks", "visual-controls", "chunk-0-0.png")));
    assert.equal(serverWorld.map.width, 16 * 64);
    assert.equal(serverWorld.map.height, 16 * 64);
    assert.deepEqual(serverWorld.map.terrain.vertexHeights, []);
    assert.deepEqual(serverWorld.map.terrain.materialGrid, []);
    assert.equal(serverWorld.map.terrain.vertexHeightPrecision, 1000);
    assert.equal(serverWorld.map.terrain.chunkAuthority.indexSha256, runtimeManifest.chunks.index.sha256);
    assert.equal(serverWorld.map.terrain.chunkAuthority.chunkCount, 1);
    assert.deepEqual(serverWorld.objects.map((object) => object.id).sort(), ["field-forge", "registrar"]);
    assert.ok(detailAuthority.resourceNodes.every((node) => node.x >= 0 && node.x <= 16 * 64 && node.y >= 0 && node.y <= 16 * 64));
    assert.deepEqual(registry.worlds.map((world) => world.id), ["promotion-proof"]);
    const resolved = resolvePromotedWorld("promotion-proof", { runtimeWorldsDir, serverWorldsDir, registryPath });
    assert.equal(resolved.serverWorldPath, result.serverWorldPath);
    assert.equal(resolved.terrainDetailAuthorityPath, result.terrainDetailAuthorityPath);
    assert.equal(resolved.manifest.chunks.count, 1);
    assert.throws(
      () => promoteWorldPackage(packageDir, approvalPath, { runtimeWorldsDir, serverWorldsDir, registryPath, requireIllustrated: false }),
      /already exists/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("promotion preserves resumable chunk illustration provenance", async () => {
  const root = path.join(ROOT, "var", `chunk-illustration-promotion-test-${process.pid}`);
  const packageDir = path.join(root, "package");
  const runtimeWorldsDir = path.join(root, "runtime-worlds");
  const serverWorldsDir = path.join(root, "server-worlds");
  const registryPath = path.join(runtimeWorldsDir, "registry.json");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(packageDir, { recursive: true });
  try {
    const recipe = applyRecipeOverrides(readRecipe(TEXTURED_RECIPE_PATH), { id: "chunk-illustration-promotion-proof" });
    recipe.macro.gameplayPixelsPerTile = 8;
    recipe.macro.travelPixelsPerTile = 4;
    recipe.macro.worldMapPixelsPerTile = 2;
    recipe.illustration.enabled = true;
    recipe.illustration.execution = "chunked-v1";
    recipe.illustration.maxLongEdge = 512;
    const recipePath = path.join(packageDir, "recipe.json");
    fs.writeFileSync(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);
    buildWorld(recipePath, { outputDir: packageDir });
    await illustrateWorldPackage(packageDir, recipe);
    validateWorldPackage(packageDir);

    const approvalPath = path.join(root, "approval.json");
    createVisualApprovalTemplate(packageDir, approvalPath);
    const approval = JSON.parse(fs.readFileSync(approvalPath, "utf8"));
    Object.assign(approval, {
      decision: "approved",
      approver: "chunk provenance test",
      reviewedAt: "2026-07-21T12:00:00.000Z",
      cameraContractAccepted: true,
      artDirectionAccepted: true,
      authorityAlignmentAccepted: true,
      statement: visualApprovalStatement,
    });
    fs.writeFileSync(approvalPath, `${JSON.stringify(approval, null, 2)}\n`);
    const result = promoteWorldPackage(packageDir, approvalPath, {
      runtimeWorldsDir,
      serverWorldsDir,
      registryPath,
    });
    const runtimeManifest = JSON.parse(fs.readFileSync(path.join(result.runtimeDir, "runtime-manifest.json"), "utf8"));
    assert.equal(runtimeManifest.chunkIllustration.jobCount, 4);
    assert.ok(runtimeManifest.chunkIllustration.totalBytes > 0);
    assert.ok(fs.existsSync(path.join(result.runtimeDir, "chunk-illustration", "index.json")));
    assert.ok(fs.existsSync(path.join(result.runtimeDir, "chunk-illustration", "review.png")));
    assert.ok(fs.existsSync(path.join(result.runtimeDir, "chunk-illustration", "jobs", "chunk-0-0.json")));
    assert.ok(fs.existsSync(path.join(result.runtimeDir, "chunk-illustration", "candidates", "chunk-0-0.png")));
    const resolved = resolvePromotedWorld("chunk-illustration-promotion-proof", { runtimeWorldsDir, serverWorldsDir, registryPath });
    assert.equal(resolved.manifest.chunkIllustration.jobCount, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("atlas routing provenance survives promotion without inventing endpoints", () => {
  const routing = serverRegionRouting({
    id: "duskfell-continent-r5-7",
    generation: {
      source: {
        atlas: { id: "duskfell-continent", contentSha256: "a".repeat(64) },
        region: { x: 5, y: 7 },
        tileOrigin: { x: 960, y: 896 },
        neighbors: {
          north: "duskfell-continent-r5-6",
          east: "duskfell-continent-r6-7",
          south: "duskfell-continent-r5-8",
          west: "duskfell-continent-r4-7",
        },
      },
    },
  });
  assert.equal(routing.regionId, "duskfell-continent-r5-7");
  assert.deepEqual(routing.tileOrigin, { x: 960, y: 896 });
  assert.equal(routing.neighbors.east, "duskfell-continent-r6-7");
  assert.equal(serverRegionRouting({ generation: { source: {} } }), null);
});
