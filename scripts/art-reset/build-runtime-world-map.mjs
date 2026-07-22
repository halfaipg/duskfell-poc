import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { noise2d } from "../../client/terrain-noise.js";
import { trailFieldAt } from "../../client/terrain-trails.js";

const root = path.resolve(import.meta.dirname, "../..");
const sourcePath = path.join(root, "assets/terrain/candidates/world-map-authoritative-painted-v3.png");
const sourceMetadataPath = path.join(root, "assets/terrain/candidates/world-map-authoritative-painted-v3.json");
const textureReferencePath = path.join(root, "assets/terrain/candidates/world-map-pathless-base-v2.png");
const textureReferenceMetadataPath = path.join(root, "assets/terrain/candidates/world-map-pathless-base-v2.json");
const worldPath = path.join(root, "server/data/world.json");
const manifestPath = path.join(root, "assets/terrain/manifest.json");
const outputDir = path.join(root, "assets/terrain/world-map");
const outputPath = path.join(outputDir, "duskfell-world-map-day-v2.webp");
const maskPath = path.join(outputDir, "duskfell-world-map-trails-v2.png");
const metadataPath = path.join(outputDir, "duskfell-world-map-day-v2.json");
const controlPath = path.join(root, "assets/terrain/candidates/world-map-authoritative-control-v3.png");
const controlMetadataPath = path.join(root, "assets/terrain/candidates/world-map-authoritative-control-v3.json");

const sourceBytes = readFileSync(sourcePath);
const sourceMetadata = JSON.parse(readFileSync(sourceMetadataPath, "utf8"));
const textureReferenceBytes = readFileSync(textureReferencePath);
const textureReferenceMetadata = JSON.parse(readFileSync(textureReferenceMetadataPath, "utf8"));
const worldBytes = readFileSync(worldPath);
const world = JSON.parse(worldBytes);
const sourceSha256 = sha256(sourceBytes);
if (sourceSha256 !== sourceMetadata.outputSha256) {
  throw new Error(`world-map source hash mismatch: expected ${sourceMetadata.outputSha256}, got ${sourceSha256}`);
}
const textureReferenceSha256 = sha256(textureReferenceBytes);
if (textureReferenceSha256 !== textureReferenceMetadata.outputSha256) {
  throw new Error(`world-map texture reference hash mismatch: expected ${textureReferenceMetadata.outputSha256}, got ${textureReferenceSha256}`);
}

const terrain = world?.map?.terrain;
const trails = terrain?.trails;
const rows = terrain?.materialGrid?.length;
const cols = terrain?.materialGrid?.[0]?.length;
if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
  throw new Error("world terrain must contain a non-empty materialGrid");
}
if (!Array.isArray(trails) || trails.length === 0) {
  throw new Error("world terrain must contain authored trails before building the runtime map");
}
if (cols !== 192 || rows !== 128) {
  throw new Error(`runtime world map expects the current 192x128 world, got ${cols}x${rows}`);
}

const tilePixels = 8;
const width = cols * tilePixels;
const height = rows * tilePixels;
const expectedBytes = width * height * 3;
const basePixels = execFileSync(
  "magick",
  [sourcePath, "-resize", `${width}x${height}!`, "-alpha", "off", "-colorspace", "sRGB", "-depth", "8", "rgb:-"],
  { maxBuffer: expectedBytes + 1024 * 1024 },
);
if (basePixels.length !== expectedBytes) {
  throw new Error(`normalized map produced ${basePixels.length} RGB bytes; expected ${expectedBytes}`);
}
const texturePixels = execFileSync(
  "magick",
  [textureReferencePath, "-resize", `${width}x${height}!`, "-alpha", "off", "-colorspace", "sRGB", "-depth", "8", "rgb:-"],
  { maxBuffer: expectedBytes + 1024 * 1024 },
);
const blurredBasePixels = execFileSync(
  "magick",
  [textureReferencePath, "-resize", `${width}x${height}!`, "-blur", "0x12", "-alpha", "off", "-colorspace", "sRGB", "-depth", "8", "rgb:-"],
  { maxBuffer: expectedBytes + 1024 * 1024 },
);
if (blurredBasePixels.length !== expectedBytes) {
  throw new Error(`blurred texture reference produced ${blurredBasePixels.length} RGB bytes; expected ${expectedBytes}`);
}

const MATERIAL_SEMANTICS = {
  grass: { family: "grass", color: [76, 105, 54] },
  field: { family: "grass", color: [96, 111, 62] },
  dirt: { family: "ground", color: [105, 82, 52] },
  stone: { family: "stone", color: [112, 109, 102] },
  rock: { family: "rock", color: [57, 61, 64] },
  water: { family: "water", color: [37, 82, 101] },
  shore: { family: "shore", color: [153, 137, 104] },
  settlement: { family: "ground", color: [137, 112, 77] },
  cobble: { family: "stone", color: [126, 118, 104] },
  ruin: { family: "ground", color: [101, 85, 68] },
};

// Geography comes only from authoritative materials and vertex heights. The
// painted source contributes a small high-frequency residual, never boundaries.
const authoritativePixels = Buffer.alloc(expectedBytes);
for (let pixelY = 0; pixelY < height; pixelY += 1) {
  const mapY = (pixelY + 0.5) / tilePixels;
  for (let pixelX = 0; pixelX < width; pixelX += 1) {
    const mapX = (pixelX + 0.5) / tilePixels;
    const semantic = semanticColorAt(mapX, mapY);
    if (!semantic) continue;

    const pixelIndex = (pixelY * width + pixelX) * 3;
    const elevation = heightAtMap(mapX, mapY);
    const east = heightAtMap(mapX + 0.55, mapY);
    const south = heightAtMap(mapX, mapY + 0.55);
    const hillshade = clamp(0.92 + (elevation - east) * 0.13 + (elevation - south) * 0.1, 0.58, 1.28);
    const broadNoise = noise2d(mapX * 0.42, mapY * 0.42, terrain.seed + 311) - 0.5;
    const fineNoise = noise2d(mapX * 2.7, mapY * 2.7, terrain.seed + 577) - 0.5;
    const sourceLuminance = luminanceAt(texturePixels, pixelIndex);
    const blurredLuminance = luminanceAt(blurredBasePixels, pixelIndex);
    const textureResidual = clamp(sourceLuminance - blurredLuminance, -24, 24) * 0.18;
    const elevationLift = semantic.family === "rock" ? clamp((elevation - 4) * 1.8, 0, 14) : 0;
    const grain = broadNoise * 12 + fineNoise * 7 + textureResidual;
    for (let channel = 0; channel < 3; channel += 1) {
      authoritativePixels[pixelIndex + channel] = Math.round(clamp(
        semantic.color[channel] * hillshade + grain + elevationLift,
        0,
        255,
      ));
    }
  }
}

mkdirSync(path.dirname(controlPath), { recursive: true });
const controlPpmPath = `${controlPath}.ppm`;
writeFileSync(controlPpmPath, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), authoritativePixels]));
try {
  execFileSync("magick", [
    controlPpmPath,
    "-strip",
    "-define",
    "png:exclude-chunk=date,time",
    controlPath,
  ]);
} finally {
  rmSync(controlPpmPath, { force: true });
}
const controlBytes = readFileSync(controlPath);
writeFileSync(controlMetadataPath, `${JSON.stringify({
  schemaVersion: "duskfell-authoritative-world-map-control-v3",
  status: "img2img-control",
  output: path.basename(controlPath),
  outputSha256: sha256(controlBytes),
  dimensions: { width, height },
  world: { path: path.relative(root, worldPath), sha256: sha256(worldBytes) },
  terrain: { cols, rows, unitsPerTile: terrain.unitsPerTile, seed: terrain.seed },
  geometryAuthority: ["materials", "vertex heights", "water", "rock", "biome boundaries"],
  excludes: ["trails", "labels", "markers", "ui"],
}, null, 2)}\n`);

const semanticAlignment = analyzeSemanticAlignment(basePixels);
if (semanticAlignment.agreement < 0.9 || semanticAlignment.rockRecall < 0.96 || semanticAlignment.waterRecall < 0.95) {
  throw new Error(`painted world-map geometry drifted from authority: ${JSON.stringify(semanticAlignment)}`);
}
const outputPixels = Buffer.from(basePixels);
const maskPixels = Buffer.alloc(width * height);
let maskPixelCount = 0;
for (let pixelY = 0; pixelY < height; pixelY += 1) {
  const mapY = (pixelY + 0.5) / tilePixels;
  for (let pixelX = 0; pixelX < width; pixelX += 1) {
    const mapX = (pixelX + 0.5) / tilePixels;
    const material = materialAt(Math.floor(mapX), Math.floor(mapY));
    if (material === "water" || material === "rock" || material == null) continue;

    const field = trailFieldAt(mapX, mapY, trails);
    if (field.pressure <= 0) continue;
    const broadNoise = noise2d(mapX * 1.65, mapY * 1.65, terrain.seed + 901);
    const grainNoise = noise2d(mapX * 5.2, mapY * 5.2, terrain.seed + 1709);
    // Keep a readable worn shoulder at world-map scale. The shared field still
    // controls the route centerline; deterministic noise prevents ruler edges.
    const centerPressure = Math.pow(field.pressure, 1.55);
    const irregularPressure = clamp((centerPressure - 0.04 + broadNoise * 0.07) / 0.96, 0, 1);
    if (irregularPressure <= 0.02) continue;

    const maskIndex = pixelY * width + pixelX;
    maskPixels[maskIndex] = Math.round(irregularPressure * 255);
    maskPixelCount += 1;

    const pixelIndex = maskIndex * 3;
    const red = outputPixels[pixelIndex];
    const green = outputPixels[pixelIndex + 1];
    const blue = outputPixels[pixelIndex + 2];
    const luminance = red * 0.3 + green * 0.59 + blue * 0.11;
    const target = [
      clamp(luminance * 1.18 + 38, 0, 255),
      clamp(luminance * 1.02 + 28, 0, 255),
      clamp(luminance * 0.76 + 17, 0, 255),
    ];
    const kindStrength = field.kind === "road" ? 0.84 : 0.7;
    const blend = irregularPressure * kindStrength * (0.9 + grainNoise * 0.1);
    outputPixels[pixelIndex] = mixChannel(red, target[0], blend, grainNoise * 2.2 * irregularPressure);
    outputPixels[pixelIndex + 1] = mixChannel(green, target[1], blend, grainNoise * 1.4 * irregularPressure);
    outputPixels[pixelIndex + 2] = mixChannel(blue, target[2], blend, grainNoise * 0.8 * irregularPressure);
  }
}

mkdirSync(outputDir, { recursive: true });
const ppmPath = `${outputPath}.ppm`;
const pgmPath = `${maskPath}.pgm`;
writeFileSync(ppmPath, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), outputPixels]));
writeFileSync(pgmPath, Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), maskPixels]));
try {
  execFileSync("magick", [
    ppmPath,
    "-strip",
    "-quality",
    "90",
    "-define",
    "webp:method=6",
    "-define",
    "webp:thread-level=0",
    outputPath,
  ]);
  execFileSync("magick", [
    pgmPath,
    "-strip",
    "-define",
    "png:exclude-chunk=date,time",
    maskPath,
  ]);
} finally {
  rmSync(ppmPath, { force: true });
  rmSync(pgmPath, { force: true });
}

const outputBytes = readFileSync(outputPath);
const maskBytes = readFileSync(maskPath);
const outputSha256 = sha256(outputBytes);
const maskSha256 = sha256(maskBytes);
const worldSha256 = sha256(worldBytes);
const trailSha256 = sha256(Buffer.from(JSON.stringify(trails)));
writeFileSync(
  metadataPath,
  `${JSON.stringify({
    schemaVersion: "duskfell-runtime-world-map-v2",
    status: "runtime-review",
    output: path.relative(path.join(root, "assets/terrain"), outputPath),
    outputSha256,
    dimensions: { width, height },
    tilePixels: { width: tilePixels, height: tilePixels },
    world: { cols, rows, path: path.relative(root, worldPath), sha256: worldSha256 },
    pathlessBase: {
      image: path.relative(path.join(root, "assets/terrain"), sourcePath),
      sha256: sourceSha256,
      provenance: path.relative(path.join(root, "assets/terrain"), sourceMetadataPath),
      semanticAlignment,
      control: path.relative(path.join(root, "assets/terrain"), controlPath),
      controlSha256: sha256(controlBytes),
    },
    authoritativeTrails: {
      count: trails.length,
      sha256: trailSha256,
      mask: path.relative(path.join(root, "assets/terrain"), maskPath),
      maskSha256,
      maskPixelCount,
      compositor: "shared polyline-distance field with deterministic edge noise and terrain-relative color blending",
    },
    textureReference: {
      image: path.relative(path.join(root, "assets/terrain"), textureReferencePath),
      sha256: textureReferenceSha256,
      provenance: path.relative(path.join(root, "assets/terrain"), textureReferenceMetadataPath),
    },
    baseRenderer: "painted pathless enrichment accepted only after authoritative semantic geometry gates",
    runtimeTreatment: "Accepted authoritative painting plus baked authoritative trail mask; live sun grading supplies dusk and night without geometry drift.",
  }, null, 2)}\n`,
);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.worldMap = {
  id: "duskfell-world-map-day-v2",
  image: "world-map/duskfell-world-map-day-v2.webp",
  sha256: outputSha256,
  width,
  height,
  worldCols: cols,
  worldRows: rows,
  tilePixelWidth: tilePixels,
  tilePixelHeight: tilePixels,
  provenance: "world-map/duskfell-world-map-day-v2.json",
  status: "runtime-review",
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  output: outputPath,
  metadata: metadataPath,
  mask: maskPath,
  outputSha256,
  maskSha256,
  width,
  height,
  trails: trails.length,
  maskPixelCount,
}));

function materialAt(x, y) {
  if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
  const index = Number.parseInt(terrain.materialGrid[y][x], 36);
  return terrain.materials[index] ?? null;
}

function semanticColorAt(mapX, mapY) {
  const centeredX = mapX - 0.5;
  const centeredY = mapY - 0.5;
  const x0 = Math.floor(centeredX);
  const y0 = Math.floor(centeredY);
  const fx = centeredX - x0;
  const fy = centeredY - y0;
  const samples = [
    [x0, y0, (1 - fx) * (1 - fy)],
    [x0 + 1, y0, fx * (1 - fy)],
    [x0, y0 + 1, (1 - fx) * fy],
    [x0 + 1, y0 + 1, fx * fy],
  ];
  const weights = new Map();
  const color = [0, 0, 0];
  let total = 0;
  for (const [x, y, weight] of samples) {
    const material = materialAt(x, y);
    const semantic = MATERIAL_SEMANTICS[material];
    if (!semantic || weight <= 0) continue;
    total += weight;
    weights.set(semantic.family, (weights.get(semantic.family) ?? 0) + weight);
    for (let channel = 0; channel < 3; channel += 1) color[channel] += semantic.color[channel] * weight;
  }
  if (total <= 0) return null;
  const family = [...weights.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { family, color: color.map((channel) => channel / total) };
}

function heightAtMap(mapX, mapY) {
  const x = clamp(mapX, 0, cols);
  const y = clamp(mapY, 0, rows);
  const x0 = Math.min(cols - 1, Math.floor(x));
  const y0 = Math.min(rows - 1, Math.floor(y));
  const x1 = Math.min(cols, x0 + 1);
  const y1 = Math.min(rows, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const north = terrain.vertexHeights[y0][x0] * (1 - fx) + terrain.vertexHeights[y0][x1] * fx;
  const south = terrain.vertexHeights[y1][x0] * (1 - fx) + terrain.vertexHeights[y1][x1] * fx;
  return north * (1 - fy) + south * fy;
}

function luminanceAt(pixels, index) {
  return pixels[index] * 0.3 + pixels[index + 1] * 0.59 + pixels[index + 2] * 0.11;
}

function analyzeSemanticAlignment(pixels) {
  const totals = { all: 0, matched: 0, rock: 0, rockMatched: 0, water: 0, waterMatched: 0 };
  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < cols; tileX += 1) {
      const channels = [0, 0, 0];
      let samples = 0;
      for (let offsetY = 2; offsetY < 6; offsetY += 1) {
        for (let offsetX = 2; offsetX < 6; offsetX += 1) {
          const index = ((tileY * tilePixels + offsetY) * width + tileX * tilePixels + offsetX) * 3;
          channels[0] += pixels[index];
          channels[1] += pixels[index + 1];
          channels[2] += pixels[index + 2];
          samples += 1;
        }
      }
      const expected = authoritativeFamily(materialAt(tileX, tileY));
      const actual = classifyPaintedPixel(...channels.map((channel) => channel / samples));
      totals.all += 1;
      if (actual === expected) totals.matched += 1;
      if (expected === "rock") {
        totals.rock += 1;
        if (actual === expected) totals.rockMatched += 1;
      }
      if (expected === "water") {
        totals.water += 1;
        if (actual === expected) totals.waterMatched += 1;
      }
    }
  }
  return {
    agreement: totals.matched / totals.all,
    rockRecall: totals.rockMatched / totals.rock,
    waterRecall: totals.waterMatched / totals.water,
    sampledTiles: totals.all,
  };
}

function authoritativeFamily(material) {
  if (material === "rock" || material === "water") return material;
  if (material === "grass" || material === "field") return "grass";
  return "ground";
}

function classifyPaintedPixel(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const luminance = red * 0.3 + green * 0.59 + blue * 0.11;
  if (blue > red * 1.12 && blue > green * 1.02) return "water";
  if (green > red * 1.07 && green > blue * 1.02) return "grass";
  if (max - min < 36 && luminance < 135) return "rock";
  return "ground";
}

function mixChannel(source, target, amount, grain) {
  return Math.round(clamp(source * (1 - amount) + target * amount + grain, 0, 255));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
