import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4110);
const startupTimeoutMs = Number(args.startupTimeoutMs ?? 10000);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const runtimeDir = path.resolve("var", "restart-smoke");
const journalPath = path.join(runtimeDir, `${runId}-journal.jsonl`);
const outboxPath = path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`);
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  const deedSmoke = await runNode(["scripts/deed-claim-smoke.js", "--url", wsUrl, "--timeoutMs", "10000"]);
  await stopServer(server);

  server = await startServer();
  const [summary, ownership] = await Promise.all([
    fetchJson(`${httpUrl}/admin/summary`),
    fetchJson(`${httpUrl}/admin/ownership`),
  ]);
  const matchingOwnership = ownership.find((receipt) => receipt.assetId === deedSmoke.claimedDeed);

  result = {
    port,
    journalPath,
    outboxPath,
    claimedDeed: deedSmoke.claimedDeed,
    deedSmokeReceipt: deedSmoke.confirmedReceipt,
    summaryAfterRestart: summary,
    matchingOwnership,
    elapsedMs: round(performance.now() - startedAt),
    ok: Boolean(
      deedSmoke.claimedDeed &&
        deedSmoke.confirmedReceipt?.assetId === deedSmoke.claimedDeed &&
        summary.settlementOwnedAssets >= 1 &&
        matchingOwnership?.assetId === deedSmoke.claimedDeed,
    ),
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
      REQUIRE_SESSION: "true",
      JOURNAL_PATH: journalPath,
      SETTLEMENT_OUTBOX_PATH: outboxPath,
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

async function waitForHealth(child) {
  const deadline = performance.now() + startupTimeoutMs;
  while (performance.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited during startup with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${httpUrl}/healthz`);
      if (response.ok && (await response.text()) === "ok") {
        return;
      }
    } catch {
      // Retry until the startup deadline.
    }
    await sleep(120);
  }
  throw new Error(`server did not become healthy on ${httpUrl}`);
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

async function runNode(commandArgs) {
  const child = spawn("node", commandArgs, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code !== 0) {
    throw new Error(`${commandArgs.join(" ")} failed with code ${code}: ${stderr || stdout}`);
  }
  return parseLastJson(stdout);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

function parseLastJson(output) {
  const start = output.lastIndexOf("\n{");
  const raw = (start >= 0 ? output.slice(start + 1) : output).trim();
  return JSON.parse(raw);
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
