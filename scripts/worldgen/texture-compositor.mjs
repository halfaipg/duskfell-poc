import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const LAYERS = [
  "meadow",
  "loam",
  "rock",
  "snow",
  "wetland",
  "water",
];

export function renderTexturedMaster(bundle, outputPath, { width, height, recipe } = {}) {
  width ??= bundle.dimensions.cols * 32;
  height ??= bundle.dimensions.rows * 32;
  const inputAssets = resolveInputAssets(recipe);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "duskfell-texture-compositor-"));
  try {
    const layers = [];
    for (const name of LAYERS) {
      const mask = path.join(temporary, `${name}-mask.pgm`);
      const resizedMask = path.join(temporary, `${name}-mask.png`);
      const resizedTexture = path.join(temporary, `${name}-texture.png`);
      const layer = path.join(temporary, `${name}-layer.png`);
      writeFieldPgm(bundle.biomeWeights[name], mask, 4);
      execFileSync("magick", [mask, "-filter", "Cubic", "-resize", `${width}x${height}!`, resizedMask]);
      execFileSync("magick", [inputAssets[name], "-filter", "Lanczos", "-resize", `${width}x${height}!`, resizedTexture]);
      execFileSync("magick", [resizedTexture, resizedMask, "-compose", "Multiply", "-composite", layer]);
      layers.push(layer);
    }
    const base = path.join(temporary, "base.png");
    execFileSync("magick", [...layers, "-evaluate-sequence", "Add", base]);

    const shaded = path.join(temporary, "shaded.png");
    const hillshadeMask = path.join(temporary, "hillshade.pgm");
    const resizedHillshade = path.join(temporary, "hillshade.png");
    writeHillshadePgm(bundle.heights, hillshadeMask, 4);
    execFileSync("magick", [hillshadeMask, "-filter", "Cubic", "-resize", `${width}x${height}!`, resizedHillshade]);
    execFileSync("magick", [base, resizedHillshade, "-compose", "Multiply", "-composite", shaded]);

    const withTrail = compositeFieldTexture({
      input: shaded,
      field: bundle.fields.trail,
      texture: inputAssets.trail,
      amount: 0.78,
      width,
      height,
      temporary,
      name: "trail",
      tint: "#715f47",
      tintAmount: "62%",
    });
    const withSettlement = compositeFieldTexture({
      input: withTrail,
      field: bundle.fields.settlement,
      texture: inputAssets.settlement,
      amount: 0.68,
      width,
      height,
      temporary,
      name: "settlement",
      tint: "#696a64",
      tintAmount: "52%",
    });
    const trailAuthority = compositeColorField({
      input: withSettlement,
      field: bundle.fields.trail,
      color: "#715f47",
      width,
      height,
      temporary,
      name: "trail-authority",
    });
    const settlementAuthority = compositeColorField({
      input: trailAuthority,
      field: bundle.fields.settlement,
      color: "#696a64",
      width,
      height,
      temporary,
      name: "settlement-authority",
    });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    execFileSync("magick", [settlementAuthority, "-colorspace", "sRGB", "-modulate", "96,92,100", "-define", "png:compression-level=9", outputPath]);
    return { path: outputPath, width, height };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function compositeColorField({ input, field, color, width, height, temporary, name }) {
  const mask = path.join(temporary, `${name}-mask.pgm`);
  const resizedMask = path.join(temporary, `${name}-mask.png`);
  const layer = path.join(temporary, `${name}-color.png`);
  const output = path.join(temporary, `${name}-composite.png`);
  writeFieldPgm(field, mask, 4);
  execFileSync("magick", [mask, "-filter", "Cubic", "-resize", `${width}x${height}!`, resizedMask]);
  execFileSync("magick", ["-size", `${width}x${height}`, `xc:${color}`, layer]);
  execFileSync("magick", [input, layer, resizedMask, "-compose", "over", "-composite", output]);
  return output;
}

function compositeFieldTexture({ input, field, texture, amount, width, height, temporary, name, tint, tintAmount }) {
  const mask = path.join(temporary, `${name}-overlay-mask.pgm`);
  const resizedMask = path.join(temporary, `${name}-overlay-mask.png`);
  const layer = path.join(temporary, `${name}-overlay.png`);
  const output = path.join(temporary, `${name}-composite.png`);
  writeFieldPgm(field.map((row) => row.map((value) => clamp(value * amount))), mask, 4);
  execFileSync("magick", [mask, "-filter", "Cubic", "-resize", `${width}x${height}!`, resizedMask]);
  execFileSync("magick", [texture, "-filter", "Lanczos", "-resize", `${width}x${height}!`, "-fill", tint, "-colorize", tintAmount, layer]);
  execFileSync("magick", [input, layer, resizedMask, "-compose", "over", "-composite", output]);
  return output;
}

function resolveInputAssets(recipe) {
  if (recipe?.illustration?.provider !== "duskfell-authority-compositor") {
    throw new Error("texture compositor requires a duskfell-authority-compositor recipe");
  }
  const result = {};
  for (const role of [...LAYERS, "trail", "settlement"]) {
    const reference = recipe.illustration.inputAssets?.[role];
    if (!reference) throw new Error(`texture compositor input ${role} is not pinned`);
    const resolved = path.resolve(ROOT, reference.path);
    const relative = path.relative(ROOT, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !relative.startsWith(`assets${path.sep}terrain${path.sep}ground-patches${path.sep}`)) {
      throw new Error(`texture compositor input ${role} path is unsafe`);
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`texture compositor input ${role} is missing`);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(resolved)).digest("hex");
    if (actual !== reference.sha256) throw new Error(`texture compositor input ${role} hash drifted`);
    result[role] = resolved;
  }
  return result;
}

function writeFieldPgm(field, outputPath, samplesPerTile) {
  const rows = field.length;
  const cols = field[0].length;
  const width = cols * samplesPerTile;
  const height = rows * samplesPerTile;
  const pixels = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    pixels[y * width + x] = Math.round(sample(field, (x + 0.5) / samplesPerTile - 0.5, (y + 0.5) / samplesPerTile - 0.5) * 255);
  }
  fs.writeFileSync(outputPath, Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), pixels]));
}

function writeHillshadePgm(heights, outputPath, samplesPerTile) {
  const rows = heights.length - 1;
  const cols = heights[0].length - 1;
  const width = cols * samplesPerTile;
  const height = rows * samplesPerTile;
  const pixels = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sx = (x + 0.5) / samplesPerTile;
    const sy = (y + 0.5) / samplesPerTile;
    const dx = sample(heights, sx + 0.4, sy) - sample(heights, sx - 0.4, sy);
    const dy = sample(heights, sx, sy + 0.4) - sample(heights, sx, sy - 0.4);
    const shade = clamp(0.9 - dx * 0.72 - dy * 0.5, 0.7, 1);
    pixels[y * width + x] = Math.round(shade * 255);
  }
  fs.writeFileSync(outputPath, Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), pixels]));
}

function sample(field, x, y) {
  const rows = field.length;
  const cols = field[0].length;
  const x0 = clamp(Math.floor(x), 0, cols - 1);
  const y0 = clamp(Math.floor(y), 0, rows - 1);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const tx = clamp(x - x0);
  const ty = clamp(y - y0);
  return (field[y0][x0] * (1 - tx) + field[y0][x1] * tx) * (1 - ty)
    + (field[y1][x0] * (1 - tx) + field[y1][x1] * tx) * ty;
}
