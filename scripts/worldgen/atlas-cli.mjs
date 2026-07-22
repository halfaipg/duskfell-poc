#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readAtlasRecipe, writeAtlasPackage } from "./continent-atlas.mjs";
import { validateAtlasPackage } from "./atlas-validator.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_RECIPE = path.join(ROOT, "worlds/atlases/duskfell-continent.json");

export function parseAtlasArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") return { help: true };
    const key = token === "-r" ? "recipe" : token === "-o" ? "output" : token.startsWith("--") ? token.slice(2) : null;
    if (!key || !["recipe", "output"].includes(key)) throw new Error(`unknown atlas argument ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${token} requires a value`);
    result[key] = value;
    index += 1;
  }
  return result;
}

export function runAtlas(argv = process.argv.slice(2)) {
  const args = parseAtlasArgs(argv);
  if (args.help) {
    process.stdout.write(help());
    return null;
  }
  const recipe = readAtlasRecipe(args.recipe ?? DEFAULT_RECIPE);
  const outputDir = path.resolve(args.output ?? path.join(ROOT, "worlds/generated", `${recipe.id}-atlas`));
  assertReviewOutput(outputDir);
  if (fs.existsSync(outputDir)) throw new Error(`output already exists: ${outputDir}; move or remove it before regenerating`);
  const stagingDir = `${outputDir}.building-${process.pid}`;
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  try {
    const result = writeAtlasPackage(recipe, stagingDir);
    const report = validateAtlasPackage(stagingDir);
    fs.renameSync(stagingDir, outputDir);
    const summary = {
      atlas: result.atlas.id,
      output: path.relative(ROOT, outputDir),
      regions: report.metrics.regions,
      worldTiles: report.metrics.totalWorldTiles,
      gameplayChunks: report.metrics.totalGameplayChunks,
      validation: "accepted",
      activation: "review-only",
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  } catch (error) {
    const rejectedDir = `${outputDir}.rejected`;
    fs.writeFileSync(path.join(stagingDir, "generation-error.json"), `${JSON.stringify({ schema: "duskfell-continent-atlas-failure-v1", state: "rejected", error: error.message }, null, 2)}\n`);
    if (fs.existsSync(rejectedDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    else fs.renameSync(stagingDir, rejectedDir);
    throw new Error(`${error.message}; rejected atlas preserved at ${path.relative(ROOT, rejectedDir)}`);
  }
}

function assertReviewOutput(outputDir) {
  const relative = path.relative(ROOT, outputDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("atlas output must stay inside the repository");
  if (["server/data", "client", "assets/terrain/worlds"].some((prefix) => relative === prefix || relative.startsWith(`${prefix}${path.sep}`))) {
    throw new Error(`atlas generator refuses live or approved runtime path ${relative}`);
  }
}

function help() {
  return `Duskfell continent atlas generator\n\nUsage:\n  npm run worldgen:atlas -- [options]\n\nOptions:\n  --recipe, -r PATH  Versioned atlas recipe\n  --output, -o PATH  Review package output\n  --help, -h          Show this help\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runAtlas();
  } catch (error) {
    process.stderr.write(`worldgen:atlas: ${error.message}\n`);
    process.exitCode = 1;
  }
}
