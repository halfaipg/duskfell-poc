#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildWorld } from "../worldgen-v2/world-pipeline.mjs";
import { atlasRegionSourceMetadata, buildAtlasRegionSource, deriveAtlasRegionRecipe, generateAtlasRegionWorld, loadAtlasRegionContext } from "./atlas-region-source.mjs";
import { illustrateWorldPackage } from "./illustration.mjs";
import { validateWorldPackage } from "./package-validator.mjs";
import { readRecipe } from "./recipe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_TEMPLATE = path.join(ROOT, "worlds/recipes/duskfell-valley.json");

export function parseRegionArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") return { help: true };
    const key = token.startsWith("--") ? token.slice(2) : null;
    if (!key || !["atlas", "coord", "template", "output", "resume"].includes(key)) throw new Error(`unknown region argument ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${token} requires a value`);
    result[key] = value;
    index += 1;
  }
  return result;
}

export async function runRegion(argv = process.argv.slice(2), options = {}) {
  const args = parseRegionArgs(argv);
  if (args.help) {
    process.stdout.write(help());
    return null;
  }
  if (!args.atlas || !args.coord) throw new Error("--atlas and --coord are required");
  if (args.resume !== undefined && !["on", "off"].includes(args.resume)) throw new Error("--resume must be on or off");
  const resume = args.resume === "on";
  const coord = parseCoord(args.coord);
  const atlasPath = path.resolve(args.atlas);
  assertRepositoryPath(atlasPath, "atlas package");
  const context = loadAtlasRegionContext(atlasPath, coord);
  const template = readRecipe(args.template ?? DEFAULT_TEMPLATE);
  const recipe = deriveAtlasRegionRecipe(template, context);
  const outputDir = path.resolve(args.output ?? path.join(ROOT, "worlds/generated", recipe.id));
  assertReviewOutput(outputDir);
  if (fs.existsSync(outputDir)) throw new Error(`output already exists: ${outputDir}; move or remove it before regenerating`);
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  const stagingDir = `${outputDir}.building`;
  const rejectedDir = `${outputDir}.rejected`;
  if (resume) {
    if (!fs.existsSync(stagingDir) && fs.existsSync(rejectedDir)) fs.renameSync(rejectedDir, stagingDir);
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.rmSync(path.join(stagingDir, "generation-error.json"), { force: true });
  } else {
    if (fs.existsSync(stagingDir) || fs.existsSync(rejectedDir)) {
      throw new Error(`incomplete region package exists; inspect it and rerun with --resume on: ${fs.existsSync(stagingDir) ? stagingDir : rejectedDir}`);
    }
    fs.mkdirSync(stagingDir, { recursive: true });
  }
  try {
    const recipePath = path.join(stagingDir, "recipe.json");
    fs.writeFileSync(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);
    const source = buildAtlasRegionSource(recipe, context);
    const sourcePath = path.join(stagingDir, "source-atlas-region.bin");
    const metadataPath = path.join(stagingDir, "source-atlas-region.json");
    fs.writeFileSync(sourcePath, source.raw);
    fs.writeFileSync(metadataPath, `${JSON.stringify(atlasRegionSourceMetadata(recipe, source, context), null, 2)}\n`);
    const bundle = generateAtlasRegionWorld(recipe, source, context);
    buildWorld(recipePath, {
      outputDir: stagingDir,
      bundle,
      sourceArtifact: { path: path.basename(sourcePath), metadata: path.basename(metadataPath), sha256: source.sha256 },
    });
    await illustrateWorldPackage(stagingDir, recipe);
    const report = validateWorldPackage(stagingDir);
    fs.renameSync(stagingDir, outputDir);
    const result = {
      world: recipe.id,
      atlas: context.atlas.id,
      region: coord,
      tileOrigin: context.descriptor.tileOrigin,
      output: path.relative(ROOT, outputDir),
      tiles: report.metrics.tiles,
      chunks: report.metrics.chunks,
      validation: "accepted",
      activation: "review-only",
      hydrologyStatus: "atlas drainage inherited; reciprocal cross-region gates validated",
    };
    if (!options.silent) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    preserveRejected(stagingDir, outputDir, recipe.id, error);
    throw error;
  }
}

function parseCoord(value) {
  const match = /^(\d+),(\d+)$/.exec(value);
  if (!match) throw new Error("--coord must use X,Y non-negative integers");
  return { x: Number(match[1]), y: Number(match[2]) };
}

function preserveRejected(stagingDir, outputDir, world, error) {
  if (!fs.existsSync(stagingDir)) return;
  fs.writeFileSync(path.join(stagingDir, "generation-error.json"), `${JSON.stringify({ schema: "duskfell-atlas-region-generation-failure-v1", world, state: "rejected", error: error.message }, null, 2)}\n`);
  const rejectedDir = `${outputDir}.rejected`;
  if (fs.existsSync(rejectedDir)) throw new Error(`${error.message}; rejected region already exists at ${rejectedDir}; working files remain at ${stagingDir}`);
  fs.renameSync(stagingDir, rejectedDir);
}

function assertRepositoryPath(target, label) {
  const relative = path.relative(ROOT, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} must stay inside the repository`);
}

function assertReviewOutput(outputDir) {
  assertRepositoryPath(outputDir, "region output");
  const relative = path.relative(ROOT, outputDir);
  if (["server/data", "client", "assets/terrain/worlds"].some((prefix) => relative === prefix || relative.startsWith(`${prefix}${path.sep}`))) {
    throw new Error(`region generator refuses live or approved runtime path ${relative}`);
  }
}

function help() {
  return `Duskfell atlas-region generator\n\nUsage:\n  npm run worldgen:region -- --atlas PACKAGE --coord X,Y [options]\n\nOptions:\n  --atlas PATH     Validated continent atlas package\n  --coord X,Y      Absolute region coordinate\n  --template PATH  Regional world recipe template\n  --output PATH    Review package output\n  --resume MODE    Resume a matching .building/.rejected package with on\n  --help, -h       Show this help\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runRegion();
  } catch (error) {
    process.stderr.write(`worldgen:region: ${error.message}\n`);
    process.exitCode = 1;
  }
}
