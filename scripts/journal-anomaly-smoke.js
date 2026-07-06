import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4123);
const runtimeDir = path.resolve("var", "journal-anomaly-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const journalPath = path.join(runtimeDir, `${runId}-journal.jsonl`);
const outboxPath = path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`);
const httpUrl = `http://127.0.0.1:${port}`;

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });
await writeAnomalousJournal();

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  const [summary, metricsText] = await Promise.all([fetchJson("/admin/summary"), fetchText("/metrics")]);
  const metrics = parseMetrics(metricsText, [
    "sundermere_journal_replayed_total_events",
    "sundermere_journal_last_sequence",
    "sundermere_journal_sequence_anomalies",
  ]);

  result = {
    port,
    journalPath,
    summary,
      metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      summary.journalReplayedTotalEvents === 5 &&
      summary.journalLastSequence === 3 &&
      summary.journalSequenceAnomalies === 2 &&
      metrics.sundermere_journal_replayed_total_events === 5 &&
      metrics.sundermere_journal_last_sequence === 3 &&
      metrics.sundermere_journal_sequence_anomalies === 2,
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

async function writeAnomalousJournal() {
  const playerId = "00000000-0000-4000-8000-000000000001";
  const events = [
    journalEvent(1, 1, playerId),
    journalEvent(2, 2, playerId),
    journalEvent(2, 3, playerId),
    journalEvent(1, 4, playerId),
    journalEvent(3, 5, playerId),
  ];
  await writeFile(journalPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

function journalEvent(sequence, tick, playerId) {
  return {
    sequence,
    tick,
    kind: {
      type: "playerJoined",
      playerId,
    },
  };
}

async function startServer() {
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${port}`,
      JOURNAL_PATH: journalPath,
      SETTLEMENT_OUTBOX_PATH: outboxPath,
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth(child);
  return child;
}

async function waitForHealth(child) {
  const deadline = performance.now() + 10000;
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
