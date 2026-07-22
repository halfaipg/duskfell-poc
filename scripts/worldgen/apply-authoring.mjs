#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateWorldAuthoringPatch } from "../../client/world-editor-authoring.js";
import { buildWorld, generateWorld } from "../worldgen-v2/world-pipeline.mjs";
import { illustrateWorldPackage } from "./illustration.mjs";
import { validateWorldPackage } from "./package-validator.mjs";
import { readRecipe, validateRecipe } from "./recipe.mjs";
import { applyTerrainOperationsToTerrainSource, generateTerrainDiffusionWorld, parseTerrainDiffusionPayload } from "./terrain-diffusion-source.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function parseAuthoringArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") return { help: true };
    const key = token.startsWith("--") ? token.slice(2) : null;
    if (!key || !["source", "patch", "id", "output", "image-api", "illustration"].includes(key)) throw new Error(`unknown authoring argument ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${token} requires a value`);
    result[key] = value;
    index += 1;
  }
  return result;
}

export async function runAuthoring(argv = process.argv.slice(2)) {
  const args = parseAuthoringArgs(argv);
  if (args.help) {
    process.stdout.write(help());
    return null;
  }
  if (!args.source || !args.patch || !args.id) throw new Error("--source, --patch, and --id are required");
  const sourceDir = path.resolve(args.source);
  const patchPath = path.resolve(args.patch);
  validateWorldPackage(sourceDir, { writeReport: false });
  const sourceBundle = readJson(path.join(sourceDir, "world-bundle-v2.json"), "source world bundle");
  const sourceRecipe = readRecipe(path.join(sourceDir, "recipe.json"));
  const authoringPatch = readJson(patchPath, "authoring patch");
  validateWorldAuthoringPatch(authoringPatch, sourceBundle, { maxSlope: sourceRecipe.planning.maxTrailSlope });
  const recipe = structuredClone(sourceRecipe);
  recipe.id = args.id;
  recipe.planning.settlements = authoringPatch.features.settlements.length;
  recipe.ecology.landmarkCount = authoringPatch.features.landmarks.length;
  if (args.illustration) {
    if (!new Set(["on", "off"]).has(args.illustration)) throw new Error("--illustration must be on or off");
    recipe.illustration.enabled = args.illustration === "on";
  }
  validateRecipe(recipe);

  const outputDir = path.resolve(args.output ?? path.join(ROOT, "worlds/generated", recipe.id));
  assertReviewOutput(outputDir);
  if (fs.existsSync(outputDir)) throw new Error(`output already exists: ${outputDir}; move or remove it before regenerating`);
  const stagingDir = `${outputDir}.building-${process.pid}`;
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  try {
    const stagedRecipe = path.join(stagingDir, "recipe.json");
    fs.writeFileSync(stagedRecipe, `${JSON.stringify(recipe, null, 2)}\n`);
    const buildOptions = {
      outputDir: stagingDir,
      bundle: reconstructSourceTerrain(recipe, sourceDir, authoringPatch.terrain?.operations ?? [], sourceBundle),
      authoredFeatures: authoringPatch.features,
      authoringPatch,
    };
    const sourceArtifact = copySourceArtifact(sourceDir, stagingDir);
    if (sourceArtifact) buildOptions.sourceArtifact = sourceArtifact;
    buildWorld(stagedRecipe, buildOptions);
    await illustrateWorldPackage(stagingDir, recipe, { apiBase: args["image-api"] });
    const report = validateWorldPackage(stagingDir);
    fs.renameSync(stagingDir, outputDir);
    const result = {
      world: recipe.id,
      sourceWorld: sourceBundle.id,
      output: path.relative(ROOT, outputDir),
      settlements: authoringPatch.features.settlements.length,
      trails: authoringPatch.features.trails.length,
      landmarks: authoringPatch.features.landmarks.length,
      terrainOperations: authoringPatch.terrain?.operations?.length ?? 0,
      tiles: report.metrics.tiles,
      validation: "accepted",
      activation: "review-only",
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    preserveRejected(stagingDir, outputDir, recipe.id, error);
    throw error;
  }
}

export function reconstructSourceTerrain(recipe, sourceDir, terrainOperations, sourceBundle = null) {
  if (recipe.source.type === "synthetic-v2") return generateWorld(recipe, { terrainOperations });
  const manifest = readJson(path.join(sourceDir, "manifest.json"), "source manifest");
  const artifact = manifest.sourceArtifact;
  if (!artifact?.path || !artifact?.metadata) throw new Error("Terrain Diffusion source package is missing its replay artifact");
  const metadata = readJson(path.join(sourceDir, artifact.metadata), "terrain source metadata");
  const raw = fs.readFileSync(path.join(sourceDir, artifact.path));
  const source = parseTerrainDiffusionPayload(raw, metadata.width, metadata.height);
  if (source.sha256 !== artifact.sha256) throw new Error("terrain source artifact hash does not match its manifest");
  if (recipe.source.type === "atlas-region-v1") {
    if (!sourceBundle || sourceBundle.generation?.algorithm !== "atlas-region-refinement-v1") throw new Error("atlas region replay requires its validated source bundle provenance");
    if (metadata.inheritedRiverChannel !== 1 || metadata.inheritedRiverRasterizer !== "atlas-flow-segments-distance-field-v1") throw new Error("atlas region replay metadata has an unsupported drainage contract");
    source.normalization = structuredClone(metadata.normalization);
    source.inheritedRiverChannel = metadata.inheritedRiverChannel;
    source.erosionSeed = metadata.erosionSeed;
    const editedSource = applyTerrainOperationsToTerrainSource(source, recipe, terrainOperations, { preserveAtlasSeams: true });
    const edited = generateTerrainDiffusionWorld(recipe, editedSource, {
      algorithm: sourceBundle.generation.algorithm,
      source: {
        ...structuredClone(sourceBundle.generation.source),
        payloadSha256: source.sha256,
        editedSourceSha256: editedSource.sha256,
      },
    });
    assertAtlasRegionSeams(edited, sourceBundle);
    return edited;
  }
  return generateTerrainDiffusionWorld(recipe, applyTerrainOperationsToTerrainSource(source, recipe, terrainOperations));
}

export function assertAtlasRegionSeams(edited, baseline) {
  for (const name of ["elevation", "water", "river", "snow"]) assertGridBoundaryEqual(edited.authority?.[name], baseline.authority?.[name], `authority.${name}`);
  for (const name of Object.keys(baseline.fields ?? {})) assertGridBoundaryEqual(edited.fields?.[name], baseline.fields[name], `fields.${name}`);
  for (const name of Object.keys(baseline.biomeWeights ?? {})) assertGridBoundaryEqual(edited.biomeWeights?.[name], baseline.biomeWeights[name], `biomeWeights.${name}`);
  const editedRows = edited.legacy?.materialGrid;
  const baselineRows = baseline.legacy?.materialGrid;
  if (!Array.isArray(editedRows) || editedRows.length !== baselineRows?.length) throw new Error("atlas terrain edit changed material seam dimensions");
  for (const y of [0, editedRows.length - 1]) if (editedRows[y] !== baselineRows[y]) throw new Error(`atlas terrain edit moved material seam at row ${y}`);
  for (let y = 0; y < editedRows.length; y += 1) {
    if (editedRows[y][0] !== baselineRows[y][0] || editedRows[y].at(-1) !== baselineRows[y].at(-1)) throw new Error(`atlas terrain edit moved material seam at row ${y}`);
  }
}

function assertGridBoundaryEqual(edited, baseline, label) {
  if (!Array.isArray(edited) || edited.length !== baseline?.length || edited.some((row, y) => !Array.isArray(row) || row.length !== baseline[y]?.length)) {
    throw new Error(`atlas terrain edit changed ${label} seam dimensions`);
  }
  const rows = edited.length;
  const cols = edited[0].length;
  for (const y of [0, rows - 1]) for (let x = 0; x < cols; x += 1) if (edited[y][x] !== baseline[y][x]) throw new Error(`atlas terrain edit moved ${label} seam at ${x},${y}`);
  for (let y = 0; y < rows; y += 1) for (const x of [0, cols - 1]) if (edited[y][x] !== baseline[y][x]) throw new Error(`atlas terrain edit moved ${label} seam at ${x},${y}`);
}

function copySourceArtifact(sourceDir, stagingDir) {
  const manifest = readJson(path.join(sourceDir, "manifest.json"), "source manifest");
  if (!manifest.sourceArtifact) return null;
  const artifact = structuredClone(manifest.sourceArtifact);
  for (const key of ["path", "metadata"]) {
    if (!artifact[key]) throw new Error(`source artifact is missing ${key}`);
    fs.copyFileSync(path.join(sourceDir, artifact[key]), path.join(stagingDir, path.basename(artifact[key])));
    artifact[key] = path.basename(artifact[key]);
  }
  return artifact;
}

function preserveRejected(stagingDir, outputDir, world, error) {
  if (!fs.existsSync(stagingDir)) return;
  fs.writeFileSync(path.join(stagingDir, "generation-error.json"), `${JSON.stringify({
    schema: "duskfell-world-generation-failure-v1",
    world,
    state: "rejected",
    error: error.message,
  }, null, 2)}\n`);
  const rejectedDir = `${outputDir}.rejected`;
  if (fs.existsSync(rejectedDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw new Error(`${error.message}; rejected package path already exists: ${rejectedDir}`);
  }
  fs.renameSync(stagingDir, rejectedDir);
}

function assertReviewOutput(outputDir) {
  const relative = path.relative(ROOT, outputDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("authoring output must stay inside the repository");
  const protectedPaths = ["server/data", "client", "assets/terrain/worlds"];
  if (protectedPaths.some((prefix) => relative === prefix || relative.startsWith(`${prefix}${path.sep}`))) {
    throw new Error(`authoring refuses to write into live or approved runtime path ${relative}`);
  }
}

function readJson(filename, label) {
  try {
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch (error) {
    throw new Error(`unable to read ${label} ${filename}: ${error.message}`);
  }
}

function help() {
  return `Duskfell world authoring patch applicator\n\nUsage:\n  npm run worldgen:apply -- --source PACKAGE --patch PATCH --id NEW_ID [options]\n\nOptions:\n  --source PATH       Validated source review package\n  --patch PATH        Hash-bound workshop authoring patch\n  --id ID             New lowercase kebab-case world id\n  --output PATH       New review package path (default: worlds/generated/<id>)\n  --illustration MODE Preserve source setting or override with on/off\n  --image-api URL     Illustration API base URL (or GRID_BASE_URL)\n  --help, -h          Show this help\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runAuthoring();
  } catch (error) {
    process.stderr.write(`worldgen:apply: ${error.message}\n`);
    process.exitCode = 1;
  }
}
