#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAtlasPackage } from "./atlas-validator.mjs";
import { runRegion } from "./region-cli.mjs";
import { validateWorldPackage } from "./package-validator.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_TEMPLATE = path.join(ROOT, "worlds/recipes/duskfell-valley.json");
const STATE_SCHEMA = "duskfell-region-generation-batch-v1";

export function parseRegionBatchArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") return { help: true };
    const key = token.startsWith("--") ? token.slice(2) : null;
    if (!key || !["atlas", "rect", "template", "output", "concurrency", "max-attempts", "resume"].includes(key)) {
      throw new Error(`unknown region batch argument ${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${token} requires a value`);
    result[key] = value;
    index += 1;
  }
  return result;
}

export async function runRegionBatch(argv = process.argv.slice(2), options = {}) {
  const args = parseRegionBatchArgs(argv);
  if (args.help) {
    process.stdout.write(help());
    return null;
  }
  if (!args.atlas || !args.rect || !args.output) throw new Error("--atlas, --rect, and --output are required");
  const atlasPath = repositoryPath(args.atlas, "atlas package");
  const templatePath = repositoryPath(args.template ?? DEFAULT_TEMPLATE, "region template");
  const outputRoot = repositoryPath(args.output, "batch output");
  assertReviewOutput(outputRoot);
  const rect = parseRect(args.rect);
  const concurrency = boundedInteger(args.concurrency ?? "2", "--concurrency", 1, 4);
  const maxAttempts = boundedInteger(args["max-attempts"] ?? "2", "--max-attempts", 1, 5);
  if (args.resume !== undefined && !["on", "off"].includes(args.resume)) throw new Error("--resume must be on or off");
  const resume = args.resume === "on";
  const validateAtlas = options.validateAtlasPackageImpl ?? validateAtlasPackage;
  validateAtlas(atlasPath, { writeReport: false });
  const atlas = readJson(path.join(atlasPath, "atlas.json"), "continent atlas");
  assertRect(rect, atlas.dimensions);
  const identity = {
    atlasManifestSha256: sha256(path.join(atlasPath, "manifest.json")),
    atlasContentSha256: atlas.contentSha256,
    templateSha256: sha256(templatePath),
    rect,
  };
  const statePath = path.join(outputRoot, "batch.json");
  let state;
  if (resume) {
    state = readJson(statePath, "region batch state");
    assertStateIdentity(state, identity);
    state.concurrency = concurrency;
    state.maxAttempts = maxAttempts;
    reconcileCompletedJobs(state, outputRoot, options.validateWorldPackageImpl ?? validateWorldPackage);
  } else {
    if (fs.existsSync(outputRoot)) throw new Error(`batch output already exists: ${outputRoot}; use --resume on after inspection`);
    fs.mkdirSync(path.join(outputRoot, "regions"), { recursive: true });
    state = createState(atlasPath, templatePath, identity, concurrency, maxAttempts);
  }
  state.state = "running";
  state.updatedAt = new Date().toISOString();
  writeJsonAtomic(statePath, state);

  const runRegionImpl = options.runRegionImpl ?? runRegion;
  const nextJob = () => state.jobs.find((job) => job.status === "pending" && job.attempts < state.maxAttempts) ?? null;
  const worker = async () => {
    while (true) {
      const job = nextJob();
      if (!job) return;
      job.status = "running";
      job.attempts += 1;
      job.startedAt = new Date().toISOString();
      job.error = null;
      state.updatedAt = job.startedAt;
      writeJsonAtomic(statePath, state);
      const regionOutput = path.join(outputRoot, ...job.output.split("/"));
      try {
        await runRegionImpl([
          "--atlas", atlasPath,
          "--coord", `${job.coord.x},${job.coord.y}`,
          "--template", templatePath,
          "--output", regionOutput,
          "--resume", "on",
        ], { silent: true });
        const manifestPath = path.join(regionOutput, "manifest.json");
        (options.validateWorldPackageImpl ?? validateWorldPackage)(regionOutput, { writeReport: false });
        job.status = "complete";
        job.manifestSha256 = sha256(manifestPath);
        job.completedAt = new Date().toISOString();
      } catch (error) {
        job.status = job.attempts < state.maxAttempts ? "pending" : "failed";
        job.error = String(error?.message ?? error).slice(0, 2000);
        job.completedAt = null;
      }
      state.updatedAt = new Date().toISOString();
      writeJsonAtomic(statePath, state);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, state.jobs.length) }, () => worker()));
  const completed = state.jobs.filter((job) => job.status === "complete").length;
  state.state = completed === state.jobs.length ? "complete" : "failed";
  state.updatedAt = new Date().toISOString();
  state.summary = { total: state.jobs.length, completed, failed: state.jobs.length - completed };
  writeJsonAtomic(statePath, state);
  const result = { batch: path.relative(ROOT, outputRoot), state: state.state, ...state.summary };
  if (!options.silent) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (state.state !== "complete") throw new Error(`region batch stopped with ${state.summary.failed} failed jobs; inspect ${path.relative(ROOT, statePath)} and resume`);
  return result;
}

function createState(atlasPath, templatePath, identity, concurrency, maxAttempts) {
  const jobs = [];
  for (let y = identity.rect.y; y < identity.rect.y + identity.rect.rows; y += 1) {
    for (let x = identity.rect.x; x < identity.rect.x + identity.rect.cols; x += 1) {
      jobs.push({
        id: `${x}-${y}`,
        coord: { x, y },
        output: `regions/${x}-${y}`,
        status: "pending",
        attempts: 0,
        manifestSha256: null,
        error: null,
        startedAt: null,
        completedAt: null,
      });
    }
  }
  return {
    schema: STATE_SCHEMA,
    state: "pending",
    atlas: { path: path.relative(ROOT, atlasPath), manifestSha256: identity.atlasManifestSha256, contentSha256: identity.atlasContentSha256 },
    template: { path: path.relative(ROOT, templatePath), sha256: identity.templateSha256 },
    selection: identity.rect,
    concurrency,
    maxAttempts,
    jobs,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function reconcileCompletedJobs(state, outputRoot, validatePackage) {
  if (state.schema !== STATE_SCHEMA || !Array.isArray(state.jobs)) throw new Error("region batch state contract is invalid");
  for (const job of state.jobs) {
    if (job.status === "running") job.status = "pending";
    const output = path.join(outputRoot, ...job.output.split("/"));
    const manifestPath = path.join(output, "manifest.json");
    if (job.status !== "complete" && fs.existsSync(output)) {
      try {
        validatePackage(output, { writeReport: false });
        job.status = "complete";
        job.manifestSha256 = sha256(manifestPath);
        job.completedAt ??= new Date().toISOString();
      } catch (error) {
        throw new Error(`orphaned region ${job.id} failed resume verification: ${error.message}`);
      }
    }
    if (job.status === "failed" && job.attempts < state.maxAttempts) job.status = "pending";
    if (job.status !== "complete") continue;
    try {
      validatePackage(output, { writeReport: false });
      if (sha256(manifestPath) !== job.manifestSha256) throw new Error("manifest hash drift");
    } catch (error) {
      throw new Error(`completed region ${job.id} failed resume verification: ${error.message}`);
    }
  }
}

function assertStateIdentity(state, identity) {
  if (state.schema !== STATE_SCHEMA
    || state.atlas?.manifestSha256 !== identity.atlasManifestSha256
    || state.atlas?.contentSha256 !== identity.atlasContentSha256
    || state.template?.sha256 !== identity.templateSha256
    || JSON.stringify(state.selection) !== JSON.stringify(identity.rect)) {
    throw new Error("region batch resume identity does not match atlas, template, or selection");
  }
}

export function parseRect(value) {
  const match = /^(\d+),(\d+):(\d+)x(\d+)$/.exec(value ?? "");
  if (!match) throw new Error("--rect must use X,Y:COLSxROWS");
  return { x: Number(match[1]), y: Number(match[2]), cols: Number(match[3]), rows: Number(match[4]) };
}

function assertRect(rect, dimensions) {
  if (rect.cols < 1 || rect.rows < 1 || rect.cols * rect.rows > 1024
    || rect.x + rect.cols > dimensions.regionCols
    || rect.y + rect.rows > dimensions.regionRows) {
    throw new Error("region batch rectangle is outside atlas bounds or exceeds 1024 jobs");
  }
}

function boundedInteger(value, label, min, max) {
  if (!/^\d+$/.test(value ?? "")) throw new Error(`${label} must be an integer`);
  const parsed = Number(value);
  if (parsed < min || parsed > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return parsed;
}

function repositoryPath(value, label) {
  const target = path.resolve(value);
  const relative = path.relative(ROOT, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} must stay inside the repository`);
  return target;
}

function assertReviewOutput(target) {
  const relative = path.relative(ROOT, target);
  if (["server/data", "client", "assets/terrain/worlds"].some((prefix) => relative === prefix || relative.startsWith(`${prefix}${path.sep}`))) {
    throw new Error(`region batch refuses live or approved runtime path ${relative}`);
  }
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

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function help() {
  return `Duskfell durable atlas-region batch\n\nUsage:\n  npm run worldgen:regions -- --atlas PACKAGE --rect X,Y:COLSxROWS --output PATH [options]\n\nOptions:\n  --atlas PATH         Validated continent atlas package\n  --rect SPEC          Region rectangle, for example 4,7:3x2\n  --template PATH      Versioned regional recipe template\n  --output PATH        Durable batch state and region packages\n  --concurrency N      Parallel region jobs, 1-4 (default: 2)\n  --max-attempts N     Attempts per region, 1-5 (default: 2)\n  --resume MODE        Reopen the exact batch with on\n  --help, -h           Show this help\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runRegionBatch();
  } catch (error) {
    process.stderr.write(`worldgen:regions: ${error.message}\n`);
    process.exitCode = 1;
  }
}
