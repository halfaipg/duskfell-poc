import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const worldDir = path.join(ROOT, "assets/terrain/worlds/valley-v2");
const candidatePath = path.resolve(process.argv[2] ?? path.join(worldDir, "illustrated-openai-v1.png"));
const bundle = JSON.parse(fs.readFileSync(path.join(worldDir, "world-bundle-v2.json"), "utf8"));
const text = execFileSync("magick", [candidatePath, "-resize", "64x64!", "-depth", "8", "txt:-"], { encoding: "utf8", maxBuffer: 8_000_000 });
const pixels = Array.from({ length: 64 }, () => Array(64));
for (const line of text.split("\n")) {
  const match = line.match(/^(\d+),(\d+):.*?\((\d+),(\d+),(\d+)/);
  if (!match) continue;
  const [, x, y, r, g, b] = match.map(Number);
  pixels[y][x] = { r, g, b };
}

const predictedWater = (pixel) => pixel && pixel.b - pixel.r > 12 && pixel.g - pixel.r > 8 && pixel.b > 32 && pixel.r < 95;
const predictedSnow = (pixel) => pixel && (pixel.r + pixel.g + pixel.b) / 3 > 96 && Math.max(pixel.r, pixel.g, pixel.b) - Math.min(pixel.r, pixel.g, pixel.b) < 38;

function score(field, expected, predicted) {
  let intersection = 0; let expectedCount = 0; let predictedCount = 0;
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
    const isExpected = expected(field[y][x]);
    const isPredicted = predicted(pixels[y][x]);
    if (isExpected) expectedCount += 1;
    if (isPredicted) predictedCount += 1;
    if (isExpected && isPredicted) intersection += 1;
  }
  const precision = intersection / Math.max(1, predictedCount);
  const recall = intersection / Math.max(1, expectedCount);
  return { intersection, expectedCount, predictedCount, precision, recall, f1: 2 * precision * recall / Math.max(1e-9, precision + recall) };
}

const water = score(bundle.fields.water, (value) => value > 0.65, predictedWater);
const snow = score(bundle.fields.snow, (value) => value > 0.3, predictedSnow);
let centerOffsetTotal = 0; let centerRows = 0;
for (let y = 0; y < 64; y += 1) {
  const expected = []; const predicted = [];
  for (let x = 0; x < 64; x += 1) {
    if (bundle.fields.river[y][x] > 0.38) expected.push(x);
    if (predictedWater(pixels[y][x])) predicted.push(x);
  }
  if (!expected.length || !predicted.length) continue;
  const expectedCenter = expected.reduce((sum, value) => sum + value, 0) / expected.length;
  const predictedCenter = predicted.reduce((sum, value) => sum + value, 0) / predicted.length;
  centerOffsetTotal += Math.abs(expectedCenter - predictedCenter);
  centerRows += 1;
}
const report = {
  schema: "duskfell-illustrated-alignment-v1",
  candidate: path.relative(ROOT, candidatePath),
  water,
  snow,
  riverMeanCenterOffsetTiles: centerOffsetTotal / Math.max(1, centerRows),
  accepted: water.f1 >= 0.72 && snow.f1 >= 0.58 && centerOffsetTotal / Math.max(1, centerRows) <= 1.5,
};
const reportPath = candidatePath.replace(/\.png$/i, "-alignment.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.accepted) process.exitCode = 1;
