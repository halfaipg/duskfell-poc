#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildWorld } from "../worldgen-v2/world-pipeline.mjs";
import { illustrateWorldPackage } from "./illustration.mjs";
import { validateWorldPackage } from "./package-validator.mjs";
import { applyRecipeOverrides, readRecipe } from "./recipe.mjs";
import { fetchTerrainDiffusionSource, generateTerrainDiffusionWorld } from "./terrain-diffusion-source.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_RECIPE = path.join(ROOT, "worlds/recipes/duskfell-valley.json");

export function parseArgs(argv) {
  const result = {};
  const aliases = new Map([["-r", "recipe"], ["-o", "output"]]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") return { help: true };
    const key = aliases.get(token) ?? (token.startsWith("--") ? token.slice(2) : null);
    if (!key || !["recipe", "output", "id", "seed", "size", "model", "api", "image-api", "illustration", "resume"].includes(key)) throw new Error(`unknown worldgen argument ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${token} requires a value`);
    result[key] = value;
    index += 1;
  }
  return result;
}

export async function run(argv = process.argv.slice(2), options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write(help());
    return null;
  }
  const recipePath = path.resolve(args.recipe ?? DEFAULT_RECIPE);
  if (args.resume !== undefined && !["on", "off"].includes(args.resume)) throw new Error("--resume must be on or off");
  const resume = args.resume === "on";
  const recipe = applyRecipeOverrides(readRecipe(recipePath), args);
  if (recipe.source.type === "atlas-region-v1") throw new Error("atlas-region-v1 recipes must be regenerated through npm run worldgen:region so parent atlas hashes are revalidated");
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
      throw new Error(`incomplete world package exists; inspect it and rerun with --resume on: ${fs.existsSync(stagingDir) ? stagingDir : rejectedDir}`);
    }
    fs.mkdirSync(stagingDir, { recursive: true });
  }
  const stagedRecipe = path.join(stagingDir, "recipe.json");
  fs.writeFileSync(stagedRecipe, `${JSON.stringify(recipe, null, 2)}\n`);

  try {
    const buildOptions = { outputDir: stagingDir };
    if (recipe.source.type === "terrain-diffusion") {
      const source = await fetchTerrainDiffusionSource(recipe, args.api ?? process.env.TERRAIN_DIFFUSION_API, {
        fetchImpl: options.fetchImpl,
      });
      const sourcePath = path.join(stagingDir, "source-terrain.bin");
      const metadataPath = path.join(stagingDir, "source-terrain.json");
      fs.writeFileSync(sourcePath, source.raw);
      const metadata = {
        schema: "duskfell-terrain-source-v1",
        type: recipe.source.type,
        repository: recipe.source.repository,
        license: recipe.source.license,
        model: recipe.source.model,
        region: recipe.source.region,
        apronTiles: recipe.macro.apronTiles,
        scale: recipe.source.scale,
        samplesPerTile: recipe.source.samplesPerTile,
        width: source.width,
        height: source.height,
        encoding: "int16le elevation followed by four interleaved float32le climate channels",
        sha256: source.sha256,
      };
      fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
      buildOptions.bundle = generateTerrainDiffusionWorld(recipe, source);
      buildOptions.sourceArtifact = {
        path: path.basename(sourcePath),
        metadata: path.basename(metadataPath),
        sha256: source.sha256,
      };
    }
    buildWorld(stagedRecipe, buildOptions);
    await illustrateWorldPackage(stagingDir, recipe, { apiBase: args["image-api"] });
    const report = validateWorldPackage(stagingDir);
    fs.renameSync(stagingDir, outputDir);
    const result = {
      world: recipe.id,
      output: path.relative(ROOT, outputDir),
      source: report.metrics.source,
      tiles: report.metrics.tiles,
      reviewSheet: path.relative(ROOT, path.join(outputDir, "review-sheet.png")),
      validation: "accepted",
      activation: "review-only",
    };
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    const failure = {
      schema: "duskfell-world-generation-failure-v1",
      world: recipe.id,
      state: "rejected",
      error: error.message,
    };
    fs.writeFileSync(path.join(stagingDir, "generation-error.json"), `${JSON.stringify(failure, null, 2)}\n`);
    const manifestPath = path.join(stagingDir, "manifest.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.state = "rejected";
      manifest.rejection = { report: "generation-error.json", reason: error.message };
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    if (fs.existsSync(rejectedDir)) throw new Error(`${error.message}; rejected package path already exists: ${rejectedDir}; working files remain at ${stagingDir}`);
    fs.renameSync(stagingDir, rejectedDir);
    throw new Error(`${error.message}; rejected package preserved at ${path.relative(ROOT, rejectedDir)}`);
  }
}

function assertReviewOutput(outputDir) {
  const relative = path.relative(ROOT, outputDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("worldgen output must stay inside the repository");
  const protectedPaths = ["server/data", "client", "assets/terrain/worlds"];
  if (protectedPaths.some((prefix) => relative === prefix || relative.startsWith(`${prefix}${path.sep}`))) {
    throw new Error(`worldgen refuses to write into live or approved runtime path ${relative}`);
  }
}

function help() {
  return `Duskfell world generator\n\nUsage:\n  npm run worldgen -- [options]\n\nOptions:\n  --recipe, -r PATH  Versioned recipe (default: worlds/recipes/duskfell-valley.json)\n  --output, -o PATH  Review package output (default: worlds/generated/<id>)\n  --id ID             Override world id\n  --seed INTEGER      Override deterministic downstream seed\n  --size COLSxROWS    Override dimensions and center the authored valley controls\n  --model NAME        Select a supported source preset or override its model\n  --api URL           Terrain Diffusion API base URL (or TERRAIN_DIFFUSION_API)\n  --image-api URL     Illustration API base URL (or GRID_BASE_URL)\n  --illustration MODE Override illustration stage with on or off\n  --resume MODE       Resume a matching .building/.rejected package with on\n  --help, -h          Show this help\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await run();
  } catch (error) {
    process.stderr.write(`worldgen: ${error.message}\n`);
    process.exitCode = 1;
  }
}
