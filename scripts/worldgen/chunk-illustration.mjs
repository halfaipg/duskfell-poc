import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { readRgbImages } from "./chunk-visuals.mjs";
import { renderTexturedMaster } from "./texture-compositor.mjs";

const DEFAULT_GRID_BASE_URL = "https://api.aipowergrid.io";
const JOB_ROOT = "chunk-illustration";

export async function renderChunkedIllustrationCandidate({
  root,
  bundle,
  recipe,
  manifest,
  candidatePath,
  apiKey,
  apiBase,
  fetchImpl = fetch,
  concurrency = 2,
}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("chunk illustration concurrency must be between 1 and 8");
  }
  const controlReference = manifest.chunkVisuals?.control;
  if (!controlReference?.index?.path || !controlReference.index.sha256) {
    throw new Error("chunked illustration requires a pinned visual control index");
  }
  const controlIndexPath = path.join(root, ...controlReference.index.path.split("/"));
  if (sha256(controlIndexPath) !== controlReference.index.sha256) {
    throw new Error("chunked illustration control index hash is invalid");
  }
  const controlIndex = readJson(controlIndexPath, "chunk visual control index");
  if (controlIndex.schema !== "duskfell-chunk-visual-control-index-v1"
    || controlIndex.world !== bundle.id
    || controlIndex.entries?.length !== controlReference.count) {
    throw new Error("chunked illustration control index contract is invalid");
  }

  const jobsDir = path.join(root, JOB_ROOT, "jobs");
  const candidatesDir = path.join(root, JOB_ROOT, "candidates");
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.mkdirSync(candidatesDir, { recursive: true });
  const localSource = recipe.illustration.provider === "duskfell-authority-compositor"
    ? renderLocalSource(root, bundle, controlIndex, recipe)
    : null;
  const jobs = new Array(controlIndex.entries.length);
  let generated = 0;
  let resumed = 0;
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= controlIndex.entries.length) return;
      const result = await runJob({
        root,
        recipe,
        entry: controlIndex.entries[index],
        apiKey,
        apiBase,
        fetchImpl,
        localSource,
      });
      jobs[index] = result.reference;
      if (result.resumed) resumed += 1;
      else generated += 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, controlIndex.entries.length) }, () => worker()));

  assembleCandidate(root, bundle, controlIndex, jobs, candidatePath);
  fs.rmSync(localSource, { force: true });
  const reviewPath = path.join(root, JOB_ROOT, "review.png");
  writeJobReview(root, jobs, controlIndex.grid, reviewPath);
  const indexRecord = {
    schema: "duskfell-chunk-illustration-index-v1",
    world: bundle.id,
    execution: "chunked-v1",
    provider: recipe.illustration.provider,
    model: recipe.illustration.model,
    sourceBundleContentSha256: bundle.contentSha256,
    sourceControlIndex: {
      path: controlReference.index.path,
      sha256: controlReference.index.sha256,
    },
    promptVersion: recipe.illustration.promptVersion,
    promptSha256: hashJson(recipe.illustration.prompt),
    jobs,
    review: {
      path: `${JOB_ROOT}/review.png`,
      sha256: sha256(reviewPath),
    },
    assembledCandidate: {
      path: path.basename(candidatePath),
      sha256: sha256(candidatePath),
      ...pngDimensions(candidatePath),
    },
  };
  const indexPath = path.join(root, JOB_ROOT, "index.json");
  writeJsonAtomic(indexPath, indexRecord);
  return {
    index: { path: `${JOB_ROOT}/index.json`, sha256: sha256(indexPath) },
    jobCount: jobs.length,
    generated,
    resumed,
    candidateSize: `${indexRecord.assembledCandidate.width}x${indexRecord.assembledCandidate.height}`,
  };
}

function writeJobReview(root, jobs, grid, outputPath) {
  execFileSync("magick", [
    "montage",
    ...jobs.map((job) => path.join(root, ...job.output.path.split("/"))),
    "-thumbnail", "240x240",
    "-tile", `${Math.min(6, grid.cols)}x`,
    "-geometry", "+8+8",
    "-background", "#111111",
    outputPath,
  ]);
  const normalized = outputPath.replace(/\.png$/, `.normalized-${process.pid}.png`);
  execFileSync("magick", [
    outputPath,
    "-strip",
    "-define", "png:exclude-chunks=date,time",
    "-define", "png:compression-level=9",
    normalized,
  ]);
  fs.renameSync(normalized, outputPath);
}

async function runJob({ root, recipe, entry, apiKey, apiBase, fetchImpl, localSource }) {
  const prompt = `${recipe.illustration.prompt}\nAuthority chunk ${entry.id}; global tile sample ${entry.sample.x},${entry.sample.y} through ${entry.sample.x + entry.sample.cols},${entry.sample.y + entry.sample.rows}. Preserve every shoreline, trail, ridge, and biome boundary exactly through the full overlap apron.`;
  const seed = chunkSeed(recipe.seed, entry.coord.x, entry.coord.y);
  const request = {
    schema: "duskfell-chunk-illustration-request-v1",
    world: recipe.id,
    chunk: entry.id,
    coord: entry.coord,
    sample: entry.sample,
    control: { path: entry.image.path, sha256: entry.image.sha256 },
    provider: recipe.illustration.provider,
    model: recipe.illustration.model,
    promptVersion: recipe.illustration.promptVersion,
    prompt,
    size: `${entry.image.width}x${entry.image.height}`,
    seed,
    strength: recipe.illustration.strength,
    steps: recipe.illustration.steps,
    cfgScale: recipe.illustration.cfgScale,
    sampler: recipe.illustration.sampler,
    outputFormat: "png",
  };
  const requestSha256 = hashJson(request);
  const jobPath = path.join(root, JOB_ROOT, "jobs", `chunk-${entry.id}.json`);
  const candidateRelative = `${JOB_ROOT}/candidates/chunk-${entry.id}.png`;
  const outputPath = path.join(root, ...candidateRelative.split("/"));
  if (fs.existsSync(jobPath)) {
    const existing = readJson(jobPath, `chunk illustration job ${entry.id}`);
    if (existing.requestSha256 !== requestSha256
      || existing.output?.path !== candidateRelative
      || !fs.existsSync(outputPath)
      || existing.output.sha256 !== sha256(outputPath)
      || existing.output.bytes !== fs.statSync(outputPath).size) {
      throw new Error(`chunk illustration job ${entry.id} cannot resume because its provenance drifted`);
    }
    const dimensions = pngDimensions(outputPath);
    if (dimensions.width !== entry.image.width || dimensions.height !== entry.image.height) {
      throw new Error(`chunk illustration job ${entry.id} resumed output dimensions drifted`);
    }
    return { resumed: true, reference: jobReference(root, jobPath, existing) };
  }

  const temporary = outputPath.replace(/\.png$/, `.building-${process.pid}.png`);
  fs.rmSync(temporary, { force: true });
  let responseRecord;
  if (localSource) {
    const ppt = entry.image.pixelsPerTile;
    execFileSync("magick", [
      localSource,
      "-crop", `${entry.image.width}x${entry.image.height}+${entry.sample.x * ppt}+${entry.sample.y * ppt}`,
      "+repage",
      "-strip",
      "-define", "png:exclude-chunks=date,time",
      "-define", "png:compression-level=9",
      temporary,
    ]);
    responseRecord = { created: null, seed, grid: { worker: "local", model: recipe.illustration.model } };
  } else {
    const controlPath = path.join(root, ...entry.image.path.split("/"));
    const body = {
      model: request.model,
      prompt: request.prompt,
      image: `data:image/png;base64,${fs.readFileSync(controlPath).toString("base64")}`,
      size: request.size,
      seed: request.seed,
      strength: request.strength,
      steps: request.steps,
      cfg_scale: request.cfgScale,
      sampler: request.sampler,
      output_format: "png",
      response_format: "b64_json",
    };
    const response = await fetchImpl(`${apiBase ?? process.env.GRID_BASE_URL ?? DEFAULT_GRID_BASE_URL}/v1/images/generations`, {
      method: "POST",
      headers: { apikey: apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`chunk illustration provider ${entry.id} ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`);
    fs.writeFileSync(temporary, await imageFromResponse(payload, fetchImpl));
    responseRecord = {
      created: payload.created ?? null,
      seed: payload.data?.[0]?.seed ?? seed,
      revisedPrompt: payload.data?.[0]?.revised_prompt ?? null,
      grid: payload.grid ?? null,
    };
  }
  const dimensions = pngDimensions(temporary);
  if (dimensions.width !== entry.image.width || dimensions.height !== entry.image.height) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`chunk illustration provider ${entry.id} returned ${dimensions.width}x${dimensions.height}, expected ${request.size}`);
  }
  fs.renameSync(temporary, outputPath);
  const job = {
    schema: "duskfell-chunk-illustration-job-v1",
    request,
    requestSha256,
    response: responseRecord,
    output: {
      path: candidateRelative,
      sha256: sha256(outputPath),
      bytes: fs.statSync(outputPath).size,
      width: dimensions.width,
      height: dimensions.height,
    },
  };
  writeJsonAtomic(jobPath, job);
  return { resumed: false, reference: jobReference(root, jobPath, job) };
}

function assembleCandidate(root, bundle, controlIndex, jobReferences, outputPath) {
  const jobs = jobReferences.map((reference) => readJson(path.join(root, ...reference.path.split("/")), `chunk illustration job ${reference.id}`));
  const entries = controlIndex.entries.map((entry, index) => ({
    ...entry,
    image: { ...entry.image, ...jobs[index].output },
  }));
  const decoded = readRgbImages(entries, root);
  const pixelsPerTile = controlIndex.sourceRaster.pixelsPerTile;
  const width = bundle.dimensions.cols * pixelsPerTile;
  const height = bundle.dimensions.rows * pixelsPerTile;
  const coverage = Array.from({ length: bundle.dimensions.cols * bundle.dimensions.rows }, () => []);
  for (let index = 0; index < entries.length; index += 1) {
    const { sample } = entries[index];
    for (let y = sample.y; y < sample.y + sample.rows; y += 1) {
      for (let x = sample.x; x < sample.x + sample.cols; x += 1) coverage[y * bundle.dimensions.cols + x].push(index);
    }
  }
  const output = Buffer.alloc(width * height * 3);
  const feather = Math.max(1, controlIndex.apronTiles * pixelsPerTile);
  for (let y = 0; y < height; y += 1) {
    const tileY = Math.floor(y / pixelsPerTile);
    for (let x = 0; x < width; x += 1) {
      const tileX = Math.floor(x / pixelsPerTile);
      const candidates = coverage[tileY * bundle.dimensions.cols + tileX];
      if (candidates.length === 0) throw new Error(`chunk illustration assembly has no coverage at ${tileX},${tileY}`);
      let weightTotal = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (const index of candidates) {
        const entry = entries[index];
        const localX = x - entry.sample.x * pixelsPerTile;
        const localY = y - entry.sample.y * pixelsPerTile;
        const edgeDistance = Math.min(localX + 1, localY + 1, entry.image.width - localX, entry.image.height - localY);
        const weight = Math.max(1, Math.min(feather, edgeDistance));
        const sourceOffset = (localY * entry.image.width + localX) * 3;
        const source = decoded.get(entry.id);
        red += source[sourceOffset] * weight;
        green += source[sourceOffset + 1] * weight;
        blue += source[sourceOffset + 2] * weight;
        weightTotal += weight;
      }
      const target = (y * width + x) * 3;
      output[target] = Math.round(red / weightTotal);
      output[target + 1] = Math.round(green / weightTotal);
      output[target + 2] = Math.round(blue / weightTotal);
    }
  }
  const ppmPath = `${outputPath}.ppm`;
  fs.writeFileSync(ppmPath, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), output]));
  try {
    execFileSync("magick", [
      ppmPath,
      "-strip",
      "-define", "png:exclude-chunks=date,time",
      "-define", "png:compression-level=9",
      outputPath,
    ]);
  } finally {
    fs.rmSync(ppmPath, { force: true });
  }
}

function renderLocalSource(root, bundle, controlIndex, recipe) {
  const output = path.join(root, JOB_ROOT, `.local-source-${process.pid}.png`);
  renderTexturedMaster(bundle, output, {
    width: bundle.dimensions.cols * controlIndex.sourceRaster.pixelsPerTile,
    height: bundle.dimensions.rows * controlIndex.sourceRaster.pixelsPerTile,
    recipe,
  });
  return output;
}

function jobReference(root, jobPath, job) {
  return {
    id: job.request.chunk,
    coord: job.request.coord,
    path: path.relative(root, jobPath).split(path.sep).join("/"),
    sha256: sha256(jobPath),
    output: { ...job.output },
  };
}

function chunkSeed(seed, x, y) {
  const digest = crypto.createHash("sha256").update(`${seed}:${x}:${y}`).digest();
  return digest.readUInt32BE(0) & 0x7fffffff;
}

async function imageFromResponse(payload, fetchImpl) {
  const item = payload.data?.[0];
  if (typeof item?.b64_json === "string") return Buffer.from(item.b64_json, "base64");
  if (typeof item?.url === "string") {
    const response = await fetchImpl(item.url, { headers: { "user-agent": "Duskfell-Worldgen/1.0" } });
    if (!response.ok) throw new Error(`chunk illustration media download ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error("chunk illustration response contains no image");
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is missing or malformed: ${error.message}`);
  }
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function pngDimensions(filePath) {
  const header = fs.readFileSync(filePath).subarray(0, 24);
  if (header.length < 24 || header.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new Error(`${filePath} is not a PNG`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
