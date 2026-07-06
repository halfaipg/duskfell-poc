import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4139);
const runtimeDir = path.resolve("var", "drain-mode-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();

  const health = await fetchText("/healthz");
  const ready = await fetchJsonAllowStatus("/readyz");
  const session = await issueSession();
  const summary = await fetchJson("/admin/summary");
  const metricsText = await fetchText("/metrics");
  const metrics = parseMetrics(metricsText, [
    "sundermere_draining",
    "sundermere_session_draining_rejected_total",
    "sundermere_session_tickets_issued_total",
    "sundermere_session_pending_tickets",
  ]);
  const drainCheck = ready.body?.checks?.find((check) => check.name === "shardNotDraining");

  result = {
    port,
    health,
    ready: {
      status: ready.status,
      ready: ready.body?.ready,
      drainCheck,
    },
    session,
    summary: {
      draining: summary.draining,
      sessionPendingTickets: summary.sessionPendingTickets,
    },
    metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      health === "ok" &&
      ready.status === 503 &&
      ready.body?.ready === false &&
      drainCheck?.ok === false &&
      typeof drainCheck?.detail === "string" &&
      drainCheck.detail.includes("draining") &&
      session.status === 503 &&
      typeof session.body === "string" &&
      session.body.includes("draining") &&
      summary.draining === true &&
      summary.sessionPendingTickets === 0 &&
      metrics.sundermere_draining === 1 &&
      metrics.sundermere_session_draining_rejected_total === 1 &&
      metrics.sundermere_session_tickets_issued_total === 0 &&
      metrics.sundermere_session_pending_tickets === 0,
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
      DRAINING: "true",
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
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

async function issueSession() {
  const response = await fetch(`${httpUrl}/api/session`, {
    method: "POST",
    headers: { accept: "application/json" },
  });
  return {
    status: response.status,
    body: await response.text(),
  };
}

async function fetchJson(endpoint) {
  const response = await fetch(`${httpUrl}${endpoint}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.json();
}

async function fetchJsonAllowStatus(endpoint) {
  const response = await fetch(`${httpUrl}${endpoint}`, {
    headers: { accept: "application/json" },
  });
  return {
    status: response.status,
    body: await response.json(),
  };
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
    const match = text.match(new RegExp(`^${name} (-?\\d+(?:\\.\\d+)?)$`, "m"));
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
