import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4166);
const runtimeDir = path.resolve("var", "durable-sync-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  const initialSummary = await fetchJson("/admin/summary");
  const initialMetrics = parseMetrics(await fetchText("/metrics"), [
    "sundermere_durable_sync_writes",
    "sundermere_journal_events",
    "sundermere_settlement_outbox_events",
  ]);
  const deedSmoke = await runNode([
    "scripts/deed-claim-smoke.js",
    "--url",
    wsUrl,
    "--timeoutMs",
    "10000",
  ]);
  const afterSummary = await fetchJson("/admin/summary");
  const afterMetrics = parseMetrics(await fetchText("/metrics"), [
    "sundermere_durable_sync_writes",
    "sundermere_journal_events",
    "sundermere_settlement_outbox_events",
  ]);
  const [journalStats, outboxStats] = await Promise.all([stat(journalPath), stat(outboxPath)]);

  result = {
    port,
    journalPath,
    outboxPath,
    initialSummary: {
      durableSyncWrites: initialSummary.durableSyncWrites,
      journalEvents: initialSummary.journalEvents,
      settlementOutboxEvents: initialSummary.settlementOutboxEvents,
    },
    afterSummary: {
      durableSyncWrites: afterSummary.durableSyncWrites,
      journalEvents: afterSummary.journalEvents,
      settlementOutboxEvents: afterSummary.settlementOutboxEvents,
    },
    initialMetrics,
    afterMetrics,
    journalBytes: journalStats.size,
    outboxBytes: outboxStats.size,
    claimedDeed: deedSmoke.claimedDeed,
    elapsedMs: round(performance.now() - startedAt),
    ok: Boolean(
      initialSummary.durableSyncWrites === true &&
        afterSummary.durableSyncWrites === true &&
        initialMetrics.sundermere_durable_sync_writes === 1 &&
        afterMetrics.sundermere_durable_sync_writes === 1 &&
        deedSmoke.claimedDeed &&
        afterSummary.journalEvents > initialSummary.journalEvents &&
        afterSummary.settlementOutboxEvents >= initialSummary.settlementOutboxEvents + 2 &&
        afterMetrics.sundermere_journal_events === afterSummary.journalEvents &&
        afterMetrics.sundermere_settlement_outbox_events ===
          afterSummary.settlementOutboxEvents &&
        journalStats.size > 0 &&
        outboxStats.size > 0,
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
      DURABLE_SYNC_WRITES: "true",
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

  await waitForHealth(child, () => logs);
  return child;
}

async function waitForHealth(child, logs) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited during startup with code ${child.exitCode}: ${logs()}`);
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
  throw new Error(`server did not become healthy on ${httpUrl}: ${logs()}`);
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

async function fetchJson(endpoint) {
  const response = await fetch(`${httpUrl}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.json();
}

async function fetchText(endpoint) {
  const response = await fetch(`${httpUrl}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.text();
}

function parseMetrics(text, names) {
  const metrics = {};
  for (const name of names) {
    const match = text.match(new RegExp(`^${name} ([0-9]+)$`, "m"));
    metrics[name] = match ? Number(match[1]) : Number.NaN;
  }
  return metrics;
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
