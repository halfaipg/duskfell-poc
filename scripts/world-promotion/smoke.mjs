#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildWorld } from "../worldgen-v2/world-pipeline.mjs";
import { validateWorldPackage } from "../worldgen/package-validator.mjs";
import { applyRecipeOverrides, readRecipe } from "../worldgen/recipe.mjs";
import { createVisualApprovalTemplate, promoteWorldPackage, visualApprovalStatement } from "./promotion.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = parsePort(process.argv.slice(2));
const runId = `${Date.now()}-${process.pid}`;
const root = path.join(ROOT, "var/world-promotion-smoke", runId);
const packageDir = path.join(root, "package");
const approvalPath = path.join(root, "approval.json");
const runtimeWorldsDir = path.join(root, "runtime-worlds");
const serverWorldsDir = path.join(root, "server-worlds");
const registryPath = path.join(runtimeWorldsDir, "registry.json");
const journalPath = path.join(root, "journal.jsonl");
const outboxPath = path.join(root, "outbox.jsonl");
let child = null;

try {
  fs.mkdirSync(packageDir, { recursive: true });
  const recipe = applyRecipeOverrides(readRecipe(path.join(ROOT, "worlds/recipes/duskfell-valley.json")), {
    id: "runtime-boot-proof",
    size: "16x16",
  });
  const recipePath = path.join(packageDir, "recipe.json");
  fs.writeFileSync(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);
  buildWorld(recipePath, { outputDir: packageDir });
  validateWorldPackage(packageDir);
  createVisualApprovalTemplate(packageDir, approvalPath);
  const approval = JSON.parse(fs.readFileSync(approvalPath, "utf8"));
  Object.assign(approval, {
    decision: "approved",
    approver: "automated runtime boot smoke",
    reviewedAt: new Date().toISOString(),
    cameraContractAccepted: true,
    artDirectionAccepted: true,
    authorityAlignmentAccepted: true,
    statement: visualApprovalStatement,
  });
  fs.writeFileSync(approvalPath, `${JSON.stringify(approval, null, 2)}\n`);
  // The smoke bypasses only the human illustrated-art requirement. All package,
  // hash, server-content, terrain-authority, and boot gates still run.
  const promoted = promoteWorldPackage(packageDir, approvalPath, {
    runtimeWorldsDir,
    serverWorldsDir,
    registryPath,
    requireIllustrated: false,
  });
  child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: ROOT,
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${port}`,
      CONTENT_PATH: promoted.serverWorldPath,
      TERRAIN_DETAIL_AUTHORITY_PATH: promoted.terrainDetailAuthorityPath,
      TERRAIN_CHUNK_INDEX_PATH: path.join(promoted.runtimeDir, "chunks/index.json"),
      JOURNAL_PATH: journalPath,
      SETTLEMENT_OUTBOX_PATH: outboxPath,
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += String(chunk); });
  child.stderr.on("data", (chunk) => { logs += String(chunk); });
  await waitForHealth(child, port, () => logs);
  const runtimeResponse = await fetch(`http://127.0.0.1:${port}/admin/runtime`);
  if (!runtimeResponse.ok) throw new Error(`runtime manifest endpoint returned ${runtimeResponse.status}`);
  const runtime = await runtimeResponse.json();
  if (runtime.content?.objectCount !== 2) throw new Error("promoted server content did not expose the two required services");
  const expectedAuthority = JSON.parse(fs.readFileSync(promoted.terrainDetailAuthorityPath, "utf8"));
  if (runtime.assets?.terrainAuthority?.resourceNodeCount !== expectedAuthority.counts.resourceNodes) {
    throw new Error("promoted ecology authority count did not reach the Rust runtime");
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    world: promoted.world,
    serverContentAccepted: true,
    resourceNodes: runtime.assets.terrainAuthority.resourceNodeCount,
    contentObjects: runtime.content.objectCount,
  }, null, 2)}\n`);
} finally {
  if (child && child.exitCode == null) {
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(3000)]);
    if (child.exitCode == null) child.kill("SIGKILL");
  }
  fs.rmSync(root, { recursive: true, force: true });
}

function parsePort(argv) {
  const index = argv.indexOf("--port");
  const value = Number(index >= 0 ? argv[index + 1] : 4178);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error("--port must be an integer from 1024 to 65535");
  return value;
}

async function waitForHealth(server, bindPort, logs) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) throw new Error(`server exited before health check:\n${logs().slice(-4000)}`);
    try {
      const response = await fetch(`http://127.0.0.1:${bindPort}/healthz`);
      if (response.ok) return;
    } catch {
      // Build/startup is still in progress.
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for promoted world server:\n${logs().slice(-4000)}`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
