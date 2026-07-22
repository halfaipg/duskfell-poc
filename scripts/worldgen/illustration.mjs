import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderTexturedMaster } from "./texture-compositor.mjs";
import { writeChunkVisualControls, writeIllustratedChunkVisuals } from "./chunk-visuals.mjs";
import { renderChunkedIllustrationCandidate } from "./chunk-illustration.mjs";

const DEFAULT_GRID_BASE_URL = "https://api.aipowergrid.io";
const BIOMES = ["meadow", "loam", "rock", "snow", "wetland", "water"];
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export async function illustrateWorldPackage(packageDir, recipe, options = {}) {
  if (!recipe.illustration.enabled) return null;
  if (!new Set(["aipowergrid", "duskfell-authority-compositor"]).has(recipe.illustration.provider)) throw new Error(`unsupported illustration provider ${recipe.illustration.provider}`);
  const apiKey = options.apiKey ?? process.env.GRID_API_KEY;
  if (recipe.illustration.provider === "aipowergrid" && !apiKey) throw new Error("illustration requires GRID_API_KEY");
  const root = path.resolve(packageDir);
  const bundle = JSON.parse(fs.readFileSync(path.join(root, "world-bundle-v2.json"), "utf8"));
  const manifestPath = path.join(root, "manifest.json");
  const packageManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const execution = recipe.illustration.execution ?? "regional-v1";
  const size = illustrationSize(recipe.dimensions, recipe.illustration.maxLongEdge);
  const controlSize = execution === "chunked-v1"
    ? `${bundle.dimensions.cols * recipe.macro.gameplayPixelsPerTile}x${bundle.dimensions.rows * recipe.macro.gameplayPixelsPerTile}`
    : size;
  const control = renderIllustrationControl(root, bundle, recipe, controlSize, options);
  const sourcePath = control.path;
  const sourceSha256 = sha256(sourcePath);
  const controlDimensions = identify(sourcePath);
  if (execution === "chunked-v1") {
    const pixelsPerTile = controlDimensions.width / bundle.dimensions.cols;
    if (!Number.isInteger(pixelsPerTile)
      || pixelsPerTile !== recipe.macro.gameplayPixelsPerTile
      || controlDimensions.height !== bundle.dimensions.rows * pixelsPerTile) {
      throw new Error("chunked illustration control must match gameplay pixels per tile exactly");
    }
    packageManifest.chunkVisuals.control = writeChunkVisualControls(
      root,
      bundle,
      recipe,
      packageManifest.chunkIndex,
      {
        path: path.relative(root, sourcePath).split(path.sep).join("/"),
        sha256: sourceSha256,
        width: controlDimensions.width,
        height: controlDimensions.height,
        pixelsPerTile,
      },
    );
    fs.writeFileSync(manifestPath, `${JSON.stringify(packageManifest, null, 2)}\n`);
  }
  const requestRecord = {
    provider: recipe.illustration.provider,
    model: recipe.illustration.model,
    promptVersion: recipe.illustration.promptVersion,
    prompt: recipe.illustration.prompt,
    source: path.basename(sourcePath),
    sourceSha256,
    size: controlSize,
    seed: recipe.seed,
    strength: recipe.illustration.strength,
    steps: recipe.illustration.steps,
    cfgScale: recipe.illustration.cfgScale,
    sampler: recipe.illustration.sampler,
    outputFormat: "png",
    execution,
    ...(recipe.illustration.inputAssets ? { inputAssets: structuredClone(recipe.illustration.inputAssets) } : {}),
  };
  const candidatePath = path.join(root, "illustrated-candidate.png");
  let responseRecord;
  let chunkJobs = null;
  let expectedCandidateSize = size;
  if (execution === "chunked-v1") {
    chunkJobs = await renderChunkedIllustrationCandidate({
      root,
      bundle,
      recipe,
      manifest: packageManifest,
      candidatePath,
      apiKey,
      apiBase: options.apiBase,
      fetchImpl: options.fetchImpl ?? fetch,
      concurrency: options.chunkConcurrency ?? 2,
    });
    requestRecord.chunkJobs = chunkJobs.index;
    requestRecord.chunkJobCount = chunkJobs.jobCount;
    expectedCandidateSize = chunkJobs.candidateSize;
    responseRecord = {
      created: null,
      seed: recipe.seed,
      revisedPrompt: null,
      grid: {
        execution,
        generated: chunkJobs.generated,
        resumed: chunkJobs.resumed,
      },
    };
  } else if (recipe.illustration.provider === "duskfell-authority-compositor") {
    const [width, height] = size.split("x").map(Number);
    renderTexturedMaster(bundle, candidatePath, { width, height, recipe });
    responseRecord = {
      created: null,
      seed: recipe.seed,
      revisedPrompt: null,
      grid: { worker: "local", model: recipe.illustration.model },
    };
  } else {
    const body = {
      model: requestRecord.model,
      prompt: requestRecord.prompt,
      image: `data:image/png;base64,${fs.readFileSync(sourcePath).toString("base64")}`,
      size,
      seed: requestRecord.seed,
      strength: requestRecord.strength,
      steps: requestRecord.steps,
      cfg_scale: requestRecord.cfgScale,
      sampler: requestRecord.sampler,
      output_format: "png",
      response_format: "b64_json",
    };
    const response = await (options.fetchImpl ?? fetch)(`${options.apiBase ?? process.env.GRID_BASE_URL ?? DEFAULT_GRID_BASE_URL}/v1/images/generations`, {
      method: "POST",
      headers: { apikey: apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`illustration provider ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`);
    const imageBytes = await imageFromResponse(payload, options.fetchImpl ?? fetch);
    fs.writeFileSync(candidatePath, imageBytes);
    responseRecord = {
      created: payload.created ?? null,
      seed: payload.data?.[0]?.seed ?? recipe.seed,
      revisedPrompt: payload.data?.[0]?.revised_prompt ?? null,
      grid: payload.grid ?? null,
    };
  }
  const actualSize = identify(candidatePath);
  if (`${actualSize.width}x${actualSize.height}` !== expectedCandidateSize) {
    throw new Error(`illustration provider returned ${actualSize.width}x${actualSize.height}, expected ${expectedCandidateSize}`);
  }
  const requestPath = path.join(root, "illustration-request.json");
  fs.writeFileSync(requestPath, `${JSON.stringify({
    schema: "duskfell-illustration-request-v1",
    request: requestRecord,
    requestSha256: hashJson(requestRecord),
    response: responseRecord,
  }, null, 2)}\n`);

  const rawReport = evaluateIllustration(candidatePath, bundle, recipe);
  const rawReportPath = path.join(root, "illustrated-candidate-alignment.json");
  writeReport(rawReportPath, rawReport);
  if (!rawReport.accepted) throw new Error(`illustration candidate failed semantic alignment: ${rawReport.failures.join("; ")}`);

  const masterPath = path.join(root, "illustrated-master.png");
  const masks = restoreAuthority(candidatePath, masterPath, bundle, recipe, root);
  const restoredReport = evaluateIllustration(masterPath, bundle, recipe, { restored: true });
  const restoredReportPath = path.join(root, "illustrated-master-alignment.json");
  writeReport(restoredReportPath, restoredReport);
  if (!restoredReport.accepted) throw new Error(`authority-restored illustration failed semantic alignment: ${restoredReport.failures.join("; ")}`);

  const manifest = packageManifest;
  manifest.structuralRasters = manifest.rasters;
  manifest.rasters = deriveLods(masterPath, bundle, recipe, root);
  manifest.chunkVisuals ??= {};
  manifest.chunkVisuals.illustrated = writeIllustratedChunkVisuals(
    root,
    bundle,
    recipe,
    manifest.chunkIndex,
    manifest.rasters.gameplay,
  );
  const reviewSheetPath = path.join(root, "review-sheet.png");
  writeReviewSheet(manifest.rasters, root, reviewSheetPath);
  manifest.reviewSheet = { path: "review-sheet.png", sha256: sha256(reviewSheetPath) };
  manifest.illustration = {
    state: "accepted",
    provider: recipe.illustration.provider,
    model: recipe.illustration.model,
    execution,
    ...(chunkJobs ? { chunkJobs: chunkJobs.index, chunkJobCount: chunkJobs.jobCount } : {}),
    control: {
      renderer: recipe.illustration.controlRenderer,
      path: path.basename(sourcePath),
      sha256: sourceSha256,
      width: controlDimensions.width,
      height: controlDimensions.height,
      pixelsPerTile: controlDimensions.width / bundle.dimensions.cols,
      ...(control.metadata ? { metadata: path.basename(control.metadata), metadataSha256: sha256(control.metadata) } : {}),
    },
    request: path.basename(requestPath),
    requestSha256: sha256(requestPath),
    candidate: { path: path.basename(candidatePath), sha256: sha256(candidatePath) },
    master: { path: path.basename(masterPath), sha256: sha256(masterPath) },
    rawAlignment: { path: path.basename(rawReportPath), sha256: sha256(rawReportPath) },
    restoredAlignment: { path: path.basename(restoredReportPath), sha256: sha256(restoredReportPath) },
    masks,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest.illustration;
}

function renderIllustrationControl(root, bundle, recipe, size, options) {
  if (recipe.illustration.controlRenderer === "structural-raster-v1") {
    return { path: path.join(root, "gameplay-master.png"), metadata: null };
  }
  const [width, height] = size.split("x").map(Number);
  const output = path.join(root, "illustration-control.png");
  const metadata = path.join(root, "illustration-control.json");
  const blender = findBlender(options.blenderBin);
  execFileSync(blender, [
    "--background",
    "--python", path.join(SCRIPT_DIR, "blender-world-structure.py"),
    "--",
    "--bundle", path.join(root, "world-bundle-v2.json"),
    "--recipe", path.join(root, "recipe.json"),
    "--output", output,
    "--metadata", metadata,
    "--width", String(width),
    "--height", String(height),
    "--samples-per-tile", String(recipe.illustration.controlSamplesPerTile),
  ], { maxBuffer: 20_000_000, stdio: ["ignore", "pipe", "pipe"] });
  restoreControlAuthority(output, bundle, recipe, root);
  const dimensions = identify(output);
  if (dimensions.width !== width || dimensions.height !== height) throw new Error("Blender illustration control dimensions are invalid");
  const preflight = evaluateIllustration(output, bundle, recipe, { controlPreflight: true });
  const preflightPath = path.join(root, "illustration-control-alignment.json");
  writeReport(preflightPath, preflight);
  if (!preflight.accepted) throw new Error(`illustration control failed semantic preflight: ${preflight.failures.join("; ")}`);
  const metadataRecord = JSON.parse(fs.readFileSync(metadata, "utf8"));
  metadataRecord.authorityRepair = "exact-package-masks-v1";
  metadataRecord.alignment = { path: path.basename(preflightPath), sha256: sha256(preflightPath) };
  fs.writeFileSync(metadata, `${JSON.stringify(metadataRecord, null, 2)}\n`);
  return { path: output, metadata };
}

function findBlender(explicit) {
  const candidates = [explicit, process.env.BLENDER_BIN, "/Applications/Blender.app/Contents/MacOS/Blender", "blender"].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === "blender" || fs.existsSync(candidate)) return candidate;
  }
  throw new Error("Blender is required for illustration.controlRenderer blender-heightfield-v1; set BLENDER_BIN");
}

export function evaluateIllustration(candidatePath, bundle, recipe, { restored = false, controlPreflight = false } = {}) {
  const { cols, rows } = bundle.dimensions;
  const pixels = readPixels(candidatePath, cols, rows);
  const palette = Object.fromEntries(BIOMES.map((name) => [name, parseHex(recipe.palette[name])]));
  const labels = pixels.map((pixel) => nearestLabel(pixel, palette));
  const water = scoreMask(bundle.fields.water, (value) => value > 0.65, labels, (label) => label === "water");
  const snowAuthority = authorityMask(bundle, (x, y) => bundle.fields.snow[y][x] > 0.3
    && bundle.fields.trail[y][x] <= 0.65
    && bundle.fields.settlement[y][x] <= 0.45
    && bundle.fields.water[y][x] <= 0.65);
  const trailAuthority = authorityMask(bundle, (x, y) => bundle.fields.trail[y][x] > 0.65
    && bundle.fields.settlement[y][x] <= 0.45
    && bundle.fields.water[y][x] <= 0.65);
  const settlementAuthority = authorityMask(bundle, (x, y) => bundle.fields.settlement[y][x] > 0.45
    && bundle.fields.water[y][x] <= 0.65);
  const expectedSnowCount = snowAuthority.flat().filter(Boolean).length;
  const snowPixels = classifySnowPixels(pixels, labels, expectedSnowCount);
  const snow = scoreMask(snowAuthority, Boolean, snowPixels, Boolean);
  const trail = scoreMask(trailAuthority, Boolean, labels, (label) => label === "loam" || label === "rock");
  const settlement = scoreMask(settlementAuthority, Boolean, labels, (label) => label === "rock" || label === "loam");
  const riverMeanCenterOffsetTiles = riverOffset(bundle, labels, cols, rows);
  const visualQuality = measureVisualQuality(candidatePath);
  const multiplier = restored ? 1.12 : 1;
  const gates = controlPreflight ? {
    waterF1: 0.9,
    snowF1: 0.7,
    riverCenterOffsetTiles: 0.75,
    trailRecall: 0.5,
    settlementRecall: 0.5,
    minEntropy: 0,
    minEdgeEnergy: 0,
  } : {
    waterF1: Math.min(0.96, recipe.illustration.gates.waterF1 * multiplier),
    snowF1: Math.min(0.94, recipe.illustration.gates.snowF1 * multiplier),
    riverCenterOffsetTiles: recipe.illustration.gates.riverCenterOffsetTiles / (restored ? 1.5 : 1),
    trailRecall: recipe.illustration.gates.trailRecall,
    settlementRecall: recipe.illustration.gates.settlementRecall,
    minEntropy: recipe.illustration.gates.minEntropy,
    minEdgeEnergy: recipe.illustration.gates.minEdgeEnergy,
  };
  const failures = [];
  if (water.f1 < gates.waterF1) failures.push(`water F1 ${round(water.f1)} < ${gates.waterF1}`);
  if (snow.f1 < gates.snowF1) failures.push(`snow F1 ${round(snow.f1)} < ${gates.snowF1}`);
  if (riverMeanCenterOffsetTiles > gates.riverCenterOffsetTiles) failures.push(`river offset ${round(riverMeanCenterOffsetTiles)} > ${gates.riverCenterOffsetTiles}`);
  if (trail.recall < gates.trailRecall) failures.push(`trail recall ${round(trail.recall)} < ${gates.trailRecall}`);
  if (settlement.recall < gates.settlementRecall) failures.push(`settlement recall ${round(settlement.recall)} < ${gates.settlementRecall}`);
  if (visualQuality.entropy < gates.minEntropy) failures.push(`entropy ${visualQuality.entropy} < ${gates.minEntropy}`);
  if (visualQuality.edgeEnergy < gates.minEdgeEnergy) failures.push(`edge energy ${visualQuality.edgeEnergy} < ${gates.minEdgeEnergy}`);
  return {
    schema: "duskfell-illustrated-alignment-v2",
    phase: controlPreflight ? "control-preflight" : restored ? "authority-restored" : "raw-candidate",
    candidate: path.basename(candidatePath),
    water,
    snow,
    trail,
    settlement,
    riverMeanCenterOffsetTiles,
    visualQuality,
    gates,
    accepted: failures.length === 0,
    failures,
  };
}

function authorityMask(bundle, predicate) {
  return Array.from({ length: bundle.dimensions.rows }, (_, y) => (
    Array.from({ length: bundle.dimensions.cols }, (_, x) => predicate(x, y))
  ));
}

function restoreControlAuthority(controlPath, bundle, recipe, root) {
  const { width, height } = identify(controlPath);
  const definitions = [
    { name: "snow", field: bundle.fields.snow, threshold: 0.3, color: recipe.palette.snow },
    { name: "trail", field: bundle.fields.trail, threshold: 0.65, color: recipe.palette.loam },
    { name: "settlement", field: bundle.fields.settlement, threshold: 0.45, color: recipe.palette.rock },
    { name: "water", field: bundle.fields.water, threshold: 0.65, color: recipe.palette.water },
  ];
  let current = controlPath;
  const temporary = [];
  for (const definition of definitions) {
    const maskPath = path.join(root, `.control-${definition.name}-mask.png`);
    const layerPath = path.join(root, `.control-${definition.name}-layer.png`);
    const compositePath = path.join(root, `.control-${definition.name}-composite.png`);
    writeBinaryMask(maskPath, definition.field, definition.threshold, width, height);
    execFileSync("magick", [controlPath, "-fill", definition.color, "-colorize", "100%", layerPath]);
    execFileSync("magick", [current, layerPath, maskPath, "-compose", "over", "-composite", compositePath]);
    if (current !== controlPath) temporary.push(current);
    temporary.push(maskPath, layerPath);
    current = compositePath;
  }
  fs.renameSync(current, `${controlPath}.authority.png`);
  fs.renameSync(`${controlPath}.authority.png`, controlPath);
  for (const file of temporary) if (fs.existsSync(file)) fs.unlinkSync(file);
}

function measureVisualQuality(filePath) {
  const entropy = Number(execFileSync("magick", [filePath, "-format", "%[entropy]", "info:"], { encoding: "utf8" }).trim());
  const edgeEnergy = Number(execFileSync("magick", [filePath, "-colorspace", "Gray", "-morphology", "Convolve", "Laplacian:0", "-format", "%[fx:standard_deviation]", "info:"], { encoding: "utf8" }).trim());
  if (!Number.isFinite(entropy) || !Number.isFinite(edgeEnergy)) throw new Error("unable to measure illustration visual quality");
  return { entropy: round(entropy, 6), edgeEnergy: round(edgeEnergy, 6) };
}

export function illustrationSize(dimensions, maxLongEdge) {
  const aspect = dimensions.cols / dimensions.rows;
  let width;
  let height;
  if (aspect >= 1) {
    width = maxLongEdge;
    height = roundTo64(maxLongEdge / aspect);
  } else {
    height = maxLongEdge;
    width = roundTo64(maxLongEdge * aspect);
  }
  return `${width}x${height}`;
}

function restoreAuthority(candidatePath, outputPath, bundle, recipe, root) {
  const { width, height } = identify(candidatePath);
  const definitions = [
    { name: "snow", field: bundle.fields.snow, color: recipe.palette.snow, amount: "74%" },
    { name: "trail", field: bundle.fields.trail, color: recipe.palette.loam, amount: "58%" },
    { name: "settlement", field: bundle.fields.settlement, color: recipe.palette.rock, amount: "62%" },
    { name: "water", field: bundle.fields.water, color: recipe.palette.water, amount: "100%" },
  ];
  let current = candidatePath;
  const temporary = [];
  const masks = {};
  for (const definition of definitions) {
    const maskPath = path.join(root, `authority-${definition.name}-mask.png`);
    if (definition.name === "water") writeRestoredWaterMask(maskPath, definition.field, width, height);
    else writeMask(maskPath, definition.field, width, height);
    const layerPath = path.join(root, `.illustration-${definition.name}-layer.png`);
    const compositePath = definition.name === "water" ? outputPath : path.join(root, `.illustration-${definition.name}-composite.png`);
    execFileSync("magick", [candidatePath, "-fill", definition.color, "-colorize", definition.amount, layerPath]);
    execFileSync("magick", [current, layerPath, maskPath, "-compose", "over", "-composite", compositePath]);
    if (current !== candidatePath) temporary.push(current);
    temporary.push(layerPath);
    current = compositePath;
    masks[definition.name] = { path: path.basename(maskPath), sha256: sha256(maskPath) };
  }
  for (const file of temporary) if (fs.existsSync(file) && file !== outputPath) fs.unlinkSync(file);
  return masks;
}

function deriveLods(masterPath, bundle, recipe, root) {
  const result = {};
  for (const [name, pixelsPerTile, filename] of [
    ["gameplay", recipe.macro.gameplayPixelsPerTile, "illustrated-gameplay.png"],
    ["travel", recipe.macro.travelPixelsPerTile, "illustrated-travel.png"],
    ["worldMap", recipe.macro.worldMapPixelsPerTile, "illustrated-world-map.png"],
  ]) {
    const width = bundle.dimensions.cols * pixelsPerTile;
    const height = bundle.dimensions.rows * pixelsPerTile;
    const output = path.join(root, filename);
    execFileSync("magick", [masterPath, "-filter", "Lanczos", "-resize", `${width}x${height}!`, "-define", "png:compression-level=9", output]);
    result[name] = { path: filename, width, height, pixelsPerTile, sha256: sha256(output) };
  }
  return result;
}

function writeReviewSheet(rasters, root, output) {
  execFileSync("magick", [
    "montage",
    path.join(root, path.basename(rasters.gameplay.path)),
    path.join(root, path.basename(rasters.travel.path)),
    path.join(root, path.basename(rasters.worldMap.path)),
    "-thumbnail", "640x640",
    "-tile", "3x1",
    "-geometry", "+16+16",
    "-background", "#111111",
    output,
  ]);
}

async function imageFromResponse(payload, fetchImpl) {
  const item = payload.data?.[0];
  if (typeof item?.b64_json === "string") return Buffer.from(item.b64_json, "base64");
  if (typeof item?.url === "string") {
    const response = await fetchImpl(item.url, { headers: { "user-agent": "Duskfell-Worldgen/1.0" } });
    if (!response.ok) throw new Error(`illustration media download ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error("illustration response contains no image");
}

function scoreMask(field, expected, labels, predicted) {
  const rows = field.length;
  const cols = field[0].length;
  let intersection = 0;
  let expectedCount = 0;
  let predictedCount = 0;
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    const isExpected = expected(field[y][x]);
    const isPredicted = predicted(labels[y * cols + x]);
    if (isExpected) expectedCount += 1;
    if (isPredicted) predictedCount += 1;
    if (isExpected && isPredicted) intersection += 1;
  }
  const precision = intersection / Math.max(1, predictedCount);
  const recall = intersection / Math.max(1, expectedCount);
  return { intersection, expectedCount, predictedCount, precision: round(precision), recall: round(recall), f1: round(2 * precision * recall / Math.max(1e-9, precision + recall)) };
}

function riverOffset(bundle, labels, cols, rows) {
  let total = 0;
  let count = 0;
  for (let y = 0; y < rows; y += 1) {
    const expected = [];
    for (let x = 0; x < cols; x += 1) if (bundle.fields.river[y][x] > 0.38) expected.push(x);
    if (expected.length === 0) continue;
    const center = expected.reduce((sum, x) => sum + x, 0) / expected.length;
    const predicted = [];
    for (let x = Math.max(0, Math.floor(center - 6)); x <= Math.min(cols - 1, Math.ceil(center + 6)); x += 1) {
      if (labels[y * cols + x] === "water") predicted.push(x);
    }
    if (predicted.length === 0) {
      total += 7;
      count += 1;
      continue;
    }
    const predictedCenter = predicted.reduce((sum, x) => sum + x, 0) / predicted.length;
    total += Math.abs(center - predictedCenter);
    count += 1;
  }
  return round(total / Math.max(1, count));
}

function writeMask(outputPath, field, width, height) {
  const rows = field.length;
  const cols = field[0].length;
  const bytes = Buffer.alloc(cols * rows);
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) bytes[y * cols + x] = Math.round(Math.max(0, Math.min(1, field[y][x])) * 255);
  const pgm = `${outputPath}.pgm`;
  fs.writeFileSync(pgm, Buffer.concat([Buffer.from(`P5\n${cols} ${rows}\n255\n`), bytes]));
  execFileSync("magick", [pgm, "-filter", "Cubic", "-resize", `${width}x${height}!`, "-blur", "0x0.45", outputPath]);
  fs.unlinkSync(pgm);
}

function writeRestoredWaterMask(outputPath, field, width, height) {
  writeBinaryMask(outputPath, field, 0.45, width, height);
  const tilePixels = Math.min(width / field[0].length, height / field.length);
  const sigma = Math.max(1, tilePixels * 0.25);
  execFileSync("magick", [outputPath, "-blur", `0x${sigma}`, "-threshold", "50%", outputPath]);
}

function writeBinaryMask(outputPath, field, threshold, width, height) {
  const rows = field.length;
  const cols = field[0].length;
  const bytes = Buffer.alloc(cols * rows);
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) bytes[y * cols + x] = field[y][x] > threshold ? 255 : 0;
  const pgm = `${outputPath}.pgm`;
  fs.writeFileSync(pgm, Buffer.concat([Buffer.from(`P5\n${cols} ${rows}\n255\n`), bytes]));
  execFileSync("magick", [pgm, "-filter", "Point", "-resize", `${width}x${height}!`, outputPath]);
  fs.unlinkSync(pgm);
}

function readPixels(filePath, width, height) {
  const bytes = execFileSync("magick", [filePath, "-filter", "Box", "-resize", `${width}x${height}!`, "-depth", "8", "rgb:-"], { maxBuffer: width * height * 4 + 1024 });
  if (bytes.length !== width * height * 3) throw new Error(`unable to read ${width}x${height} illustration pixels`);
  return Array.from({ length: width * height }, (_, index) => [bytes[index * 3], bytes[index * 3 + 1], bytes[index * 3 + 2]]);
}

function nearestLabel(pixel, palette) {
  if (pixel[2] - pixel[0] > 10 && pixel[1] - pixel[0] > 5 && pixel[2] > 34 && pixel[0] < 120) return "water";
  let winner = null;
  let distance = Infinity;
  for (const [name, color] of Object.entries(palette)) {
    const candidate = colorDistance(pixel, color);
    if (candidate < distance) {
      winner = name;
      distance = candidate;
    }
  }
  return winner;
}

function classifySnowPixels(pixels, labels, expectedCount) {
  if (expectedCount === 0) return pixels.map(() => false);
  const selected = new Set(labels.flatMap((label, index) => label === "snow" ? [index] : []));
  if (selected.size >= expectedCount * 0.7) return pixels.map((_, index) => selected.has(index));
  const candidates = pixels.map((pixel, index) => ({
    index,
    brightness: (pixel[0] + pixel[1] + pixel[2]) / 3,
    chroma: Math.max(...pixel) - Math.min(...pixel),
  })).filter((sample) => sample.chroma < 62).sort((a, b) => b.brightness - a.brightness || a.index - b.index);
  const targetCount = Math.min(candidates.length, Math.max(expectedCount, Math.ceil(expectedCount * 1.45)));
  for (const sample of candidates) {
    selected.add(sample.index);
    if (selected.size >= targetCount) break;
  }
  return pixels.map((_, index) => selected.has(index));
}

function colorDistance(a, b) {
  const meanRed = (a[0] + b[0]) / 2;
  const red = a[0] - b[0];
  const green = a[1] - b[1];
  const blue = a[2] - b[2];
  return (2 + meanRed / 256) * red * red + 4 * green * green + (2 + (255 - meanRed) / 256) * blue * blue;
}

function parseHex(value) {
  return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function identify(filePath) {
  const result = execFileSync("magick", ["identify", "-format", "%w %h", filePath], { encoding: "utf8" }).trim().split(/\s+/).map(Number);
  if (result.length !== 2 || !result.every(Number.isFinite)) throw new Error(`${filePath} is not a readable image`);
  return { width: result[0], height: result[1] };
}

function roundTo64(value) {
  return Math.max(512, Math.min(1536, Math.round(value / 64) * 64));
}

function writeReport(filePath, report) {
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`);
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}
