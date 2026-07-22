#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { renderStructural } from "../worldgen-v2/world-pipeline.mjs";
import { applyRecipeOverrides, readRecipe, validateRecipe } from "./recipe.mjs";
import { fetchTerrainDiffusionSource, generateTerrainDiffusionWorld } from "./terrain-diffusion-source.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_RECIPE = path.join(ROOT, "worlds/recipes/terrain-diffusion-frontier.json");

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const base = readRecipe(path.resolve(args.recipe ?? DEFAULT_RECIPE));
  if (base.source.type !== "terrain-diffusion") throw new Error("world survey requires a terrain-diffusion recipe");
  const [sampleCols, sampleRows] = parsePair(args.size ?? `${base.dimensions.cols}x${base.dimensions.rows}`, "--size", "x");
  const [gridCols, gridRows] = parsePair(args.grid ?? "4x3", "--grid", "x");
  const [originI, originJ] = parsePair(args.origin ?? `${base.source.region.i},${base.source.region.j}`, "--origin", ",", true);
  const stride = parseInteger(args.stride ?? "256", "--stride", 1, 100000);
  const apiBase = args.api ?? process.env.TERRAIN_DIFFUSION_API;
  if (!apiBase) throw new Error("world survey requires --api or TERRAIN_DIFFUSION_API");
  const output = path.resolve(args.output ?? path.join(ROOT, "worlds/surveys", `survey-${originI}-${originJ}-${gridCols}x${gridRows}`));
  assertSurveyOutput(output);
  if (fs.existsSync(output)) throw new Error(`survey output already exists: ${output}`);
  fs.mkdirSync(output, { recursive: true });
  const entries = [];
  try {
    for (let row = 0; row < gridRows; row += 1) {
      for (let column = 0; column < gridCols; column += 1) {
        const i = originI + row * stride;
        const j = originJ + column * stride;
        let recipe = applyRecipeOverrides(base, { id: `survey-${row}-${column}`, size: `${sampleCols}x${sampleRows}` });
        recipe.source.region = { i, j };
        recipe.illustration.enabled = false;
        recipe = validateRecipe(recipe);
        const source = await fetchTerrainDiffusionSource(recipe, apiBase);
        const bundle = generateTerrainDiffusionWorld(recipe, source);
        const preview = path.join(output, `region-${row}-${column}.png`);
        renderStructural(bundle, recipe, preview, 8);
        const metrics = measure(bundle, recipe);
        const score = rank(metrics);
        const labeled = path.join(output, `region-${row}-${column}-labeled.png`);
        execFileSync("magick", [preview, "-background", "#111111", "-fill", "#f1eee6", "-gravity", "north", "-splice", "0x34", "-pointsize", "16", "-annotate", "+0+7", `i=${i} j=${j}  score=${score.toFixed(3)}`, labeled]);
        entries.push({ row, column, region: { i, j }, sourceSha256: source.sha256, preview: path.basename(preview), labeled: path.basename(labeled), metrics, score });
        process.stdout.write(`survey ${row * gridCols + column + 1}/${gridCols * gridRows}: ${i},${j}\n`);
      }
    }
    entries.sort((a, b) => b.score - a.score || a.row - b.row || a.column - b.column);
    const contactSheet = path.join(output, "contact-sheet.png");
    const ordered = [...entries].sort((a, b) => a.row - b.row || a.column - b.column);
    execFileSync("magick", ["montage", ...ordered.map((entry) => path.join(output, entry.labeled)), "-tile", `${gridCols}x${gridRows}`, "-geometry", "+10+10", "-background", "#0d0e0c", contactSheet]);
    const report = {
      schema: "duskfell-terrain-region-survey-v1",
      recipe: path.relative(ROOT, path.resolve(args.recipe ?? DEFAULT_RECIPE)),
      source: { repository: base.source.repository, model: base.source.model, scale: base.source.scale, samplesPerTile: base.source.samplesPerTile, apronTiles: base.macro.apronTiles },
      dimensions: { cols: sampleCols, rows: sampleRows },
      grid: { cols: gridCols, rows: gridRows, originI, originJ, stride },
      best: entries[0],
      entries,
      contactSheet: "contact-sheet.png",
    };
    fs.writeFileSync(path.join(output, "survey.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ output: path.relative(ROOT, output), contactSheet: path.relative(ROOT, contactSheet), best: report.best }, null, 2)}\n`);
  } catch (error) {
    fs.writeFileSync(path.join(output, "survey-error.json"), `${JSON.stringify({ schema: "duskfell-terrain-region-survey-error-v1", error: error.message }, null, 2)}\n`);
    throw error;
  }
}

function measure(bundle, recipe) {
  const heights = bundle.heights.flat();
  const mean = heights.reduce((sum, value) => sum + value, 0) / heights.length;
  const elevationStd = Math.sqrt(heights.reduce((sum, value) => sum + (value - mean) ** 2, 0) / heights.length);
  const cells = bundle.dimensions.cols * bundle.dimensions.rows;
  const meanField = (name) => bundle.fields[name].flat().reduce((sum, value) => sum + value, 0) / cells;
  const fraction = (name, threshold) => bundle.fields[name].flat().filter((value) => value > threshold).length / cells;
  let playableCells = 0;
  let ruggedPlayableCells = 0;
  const maxTrailSlope = recipe.planning.maxTrailSlope;
  for (let y = 0; y < bundle.dimensions.rows; y += 1) for (let x = 0; x < bundle.dimensions.cols; x += 1) {
    const playable = bundle.fields.water[y][x] <= 0.25 && bundle.fields.slope[y][x] <= maxTrailSlope;
    if (playable) playableCells += 1;
    if (playable && bundle.fields.slope[y][x] >= 0.08) ruggedPlayableCells += 1;
  }
  return {
    elevationMean: round(mean),
    elevationStd: round(elevationStd),
    slopeMean: round(meanField("slope")),
    waterFraction: round(fraction("water", 0.65)),
    riverFraction: round(fraction("river", 0.25)),
    snowFraction: round(fraction("snow", 0.3)),
    vegetationMean: round(meanField("vegetation")),
    playableFraction: round(playableCells / cells),
    ruggedPlayableFraction: round(ruggedPlayableCells / cells),
  };
}

function rank(metrics) {
  const waterPenalty = Math.abs(metrics.waterFraction - 0.1) * 1.4;
  const snowPenalty = Math.max(0, metrics.snowFraction - 0.28) * 1.2;
  const emptyPenalty = metrics.waterFraction < 0.015 ? 0.25 : 0;
  const traversalPenalty = Math.max(0, 0.62 - metrics.playableFraction) * 3.2;
  const extremeSlopePenalty = Math.max(0, metrics.slopeMean - 0.42) * 1.8;
  return metrics.elevationStd * 1.75
    + metrics.ruggedPlayableFraction * 0.85
    + Math.min(0.18, metrics.riverFraction) * 0.8
    + metrics.vegetationMean * 0.12
    - waterPenalty - snowPenalty - emptyPenalty - traversalPenalty - extremeSlopePenalty;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    if (!token?.startsWith("--") || !["recipe", "api", "output", "origin", "grid", "stride", "size"].includes(token.slice(2))) throw new Error(`unknown survey argument ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    result[token.slice(2)] = value;
  }
  return result;
}

function parsePair(value, label, separator, signed = false) {
  const pattern = signed ? new RegExp(`^(-?\\d+)${separator}(-?\\d+)$`) : new RegExp(`^(\\d+)${separator}(\\d+)$`);
  const match = pattern.exec(value);
  if (!match) throw new Error(`${label} is invalid`);
  return [Number(match[1]), Number(match[2])];
}

function parseInteger(value, label, min, max) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer`);
  const parsed = Number(value);
  if (parsed < min || parsed > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return parsed;
}

function assertSurveyOutput(output) {
  const relative = path.relative(ROOT, output);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("survey output must stay inside the repository");
  if (!relative.startsWith(`worlds${path.sep}surveys${path.sep}`)) throw new Error("survey output must stay under worlds/surveys");
}

function round(value) {
  return Number(value.toFixed(5));
}

main().catch((error) => {
  process.stderr.write(`world survey: ${error.message}\n`);
  process.exitCode = 1;
});
