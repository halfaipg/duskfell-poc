import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

import { readPngDimensions } from "./verify-sprite-manifest.js";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4134);
const runtimeDir = path.resolve("var", "assets-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;
const startedAt = performance.now();

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;

try {
  server = await startServer();
  const manifestResponse = await fetch(`${httpUrl}/assets/sprites/manifest.json`);
  const manifest = await manifestResponse.json();
  const playerSheet = manifest.sheets.find((sheet) => sheet.id === "player-placeholder");
  const propSheet = manifest.sheets.find((sheet) => sheet.id === "props-placeholder");
  const imageResponse = await fetch(`${httpUrl}/assets/sprites/${playerSheet.image}`);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const imageDimensions = readPngDimensions(imageBuffer);
  const imageSha256 = sha256Hex(imageBuffer);
  const expectedWidth = playerSheet.frameGrid.columns * playerSheet.frameGrid.cellWidth;
  const expectedHeight = playerSheet.frameGrid.rows * playerSheet.frameGrid.cellHeight;
  const propImageResponse = await fetch(`${httpUrl}/assets/sprites/${propSheet.image}`);
  const propImageBuffer = Buffer.from(await propImageResponse.arrayBuffer());
  const propImageDimensions = readPngDimensions(propImageBuffer);
  const propImageSha256 = sha256Hex(propImageBuffer);
  const expectedPropWidth = propSheet.frameGrid.columns * propSheet.frameGrid.cellWidth;
  const expectedPropHeight = propSheet.frameGrid.rows * propSheet.frameGrid.cellHeight;
  const terrainManifestResponse = await fetch(`${httpUrl}/assets/terrain/manifest.json`);
  const terrainManifest = await terrainManifestResponse.json();
  const terrainImageResponse = await fetch(`${httpUrl}/assets/terrain/${terrainManifest.tileSheet.image}`);
  const terrainImageBuffer = Buffer.from(await terrainImageResponse.arrayBuffer());
  const terrainImageDimensions = readPngDimensions(terrainImageBuffer);
  const terrainImageSha256 = sha256Hex(terrainImageBuffer);
  const expectedTerrainWidth = terrainManifest.tileSheet.columns * terrainManifest.tileSheet.cellWidth;
  const expectedTerrainHeight = terrainManifest.tileSheet.rows * terrainManifest.tileSheet.cellHeight;

  result = {
    port,
    manifestStatus: manifestResponse.status,
    imageStatus: imageResponse.status,
    projection: manifest.projection,
    playerSheet: {
      id: playerSheet.id,
      image: playerSheet.image,
      cellWidth: playerSheet.frameGrid.cellWidth,
      cellHeight: playerSheet.frameGrid.cellHeight,
      columns: playerSheet.frameGrid.columns,
      rows: playerSheet.frameGrid.rows,
      imageSha256: playerSheet.imageSha256,
      actualImageSha256: imageSha256,
      render: playerSheet.render,
      approvalState: playerSheet.approval.state,
    },
    imageDimensions,
    propSheet: {
      id: propSheet.id,
      image: propSheet.image,
      cellWidth: propSheet.frameGrid.cellWidth,
      cellHeight: propSheet.frameGrid.cellHeight,
      columns: propSheet.frameGrid.columns,
      rows: propSheet.frameGrid.rows,
      imageSha256: propSheet.imageSha256,
      actualImageSha256: propImageSha256,
      render: propSheet.render,
      approvalState: propSheet.approval.state,
    },
    propImageDimensions,
    terrain: {
      manifestStatus: terrainManifestResponse.status,
      imageStatus: terrainImageResponse.status,
      schemaVersion: terrainManifest.schemaVersion,
      tileSheet: terrainManifest.tileSheet,
      imageDimensions: terrainImageDimensions,
      actualImageSha256: terrainImageSha256,
      tileCount: terrainManifest.tiles.length,
    },
    elapsedMs: round(performance.now() - startedAt),
    ok:
      manifestResponse.ok &&
      imageResponse.ok &&
      manifest.projection.kind === "military-plan-oblique" &&
      manifest.projection.tileWidth === 64 &&
      manifest.projection.tileHeight === 64 &&
      manifest.projection.tileAspectRatio === 1 &&
      manifest.projection.axisAngleDegrees === 45 &&
      manifest.projection.heightAxis === "screen-y" &&
      playerSheet.render?.layer === "actor" &&
      playerSheet.render?.sort === "footprint-y" &&
      Number.isInteger(playerSheet.render?.zBias) &&
      playerSheet.render?.shadow?.kind === "ellipse" &&
      Number.isFinite(playerSheet.render?.shadow?.opacity) &&
      playerSheet.approval.state === "placeholder" &&
      playerSheet.imageSha256 === imageSha256 &&
      imageDimensions.width === expectedWidth &&
      imageDimensions.height === expectedHeight &&
      propImageResponse.ok &&
      propSheet.render?.layer === "prop" &&
      propSheet.render?.sort === "footprint-y" &&
      propSheet.render?.shadow?.kind === "ellipse" &&
      propSheet.approval.state === "placeholder" &&
      propSheet.imageSha256 === propImageSha256 &&
      propImageDimensions.width === expectedPropWidth &&
      propImageDimensions.height === expectedPropHeight &&
      terrainManifestResponse.ok &&
      terrainImageResponse.ok &&
      terrainManifest.schemaVersion === "duskfell-terrain-atlas-v1" &&
      terrainManifest.projection.kind === "military-plan-oblique" &&
      terrainManifest.projection.tileWidth === 64 &&
      terrainManifest.projection.tileHeight === 64 &&
      terrainManifest.tileSheet.sha256 === terrainImageSha256 &&
      terrainImageDimensions.width === expectedTerrainWidth &&
      terrainImageDimensions.height === expectedTerrainHeight &&
      terrainManifest.tiles.some((tile) => tile.material === "water" && tile.surface?.walkable === false),
  };
} finally {
  if (server) {
    await stopServer(server);
  }
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) {
  process.exitCode = 1;
}

async function startServer() {
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${port}`,
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    logs += String(chunk);
  });

  await waitForHealth(child, logs);
  return child;
}

async function waitForHealth(child, logs) {
  const deadline = performance.now() + 10000;
  const url = `${httpUrl}/healthz`;
  while (performance.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited during startup with code ${child.exitCode}: ${logs}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok && (await response.text()) === "ok") {
        return;
      }
    } catch {
      // Retry until the startup deadline.
    }
    await sleep(120);
  }
  throw new Error(`server did not become healthy on ${url}: ${logs}`);
}

async function stopServer(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGINT");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3000).then(() => {
      if (child.exitCode == null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    parsed[key] = inlineValue ?? rawArgs[index + 1];
    if (inlineValue == null) index += 1;
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
