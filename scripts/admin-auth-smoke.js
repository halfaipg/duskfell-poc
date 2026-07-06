import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4111);
const startupTimeoutMs = Number(args.startupTimeoutMs ?? 10000);
const adminToken = args.adminToken ?? `admin-smoke-${Date.now()}`;
const oversizedToken = "x".repeat(5000);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const runtimeDir = path.resolve("var", "admin-auth-smoke");
const journalPath = path.join(runtimeDir, `${runId}-journal.jsonl`);
const outboxPath = path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`);
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
  const endpoints = [
    "/admin/summary",
    "/admin/events",
    "/admin/ownership",
    "/admin/runtime",
    "/api/snapshot",
  ];
  const checks = [];

  for (const endpoint of endpoints) {
    checks.push({
      endpoint,
      missing: await fetchStatus(endpoint),
      wrong: await fetchStatus(endpoint, "wrong-token"),
      oversized: await fetchStatus(endpoint, oversizedToken),
      correct: await fetchStatus(endpoint, adminToken),
    });
  }

  const health = await fetchText("/healthz");
  const sessionStatus = await fetchStatus("/api/session", null, { method: "POST" });
  const metrics = parseMetrics(await fetchText("/metrics"), ["sundermere_admin_auth_rejected_total"]);
  const summary = await fetchJson("/admin/summary", adminToken);
  const summaryText = JSON.stringify(summary);
  const summaryPathRedaction = {
    journalPath: summary.journalPath,
    settlementOutboxPath: summary.settlementOutboxPath,
    absoluteRuntimeDirAbsent:
      !summaryText.includes(runtimeDir) &&
      !summaryText.includes(journalPath) &&
      !summaryText.includes(outboxPath),
    ok:
      summary.journalPath === "journal.jsonl" &&
      summary.settlementOutboxPath === "settlement-outbox.jsonl" &&
      !summaryText.includes(runtimeDir) &&
      !summaryText.includes(journalPath) &&
      !summaryText.includes(outboxPath),
  };
  const allAdminProtected = checks.every(
    (check) =>
      check.missing === 401 &&
      check.wrong === 401 &&
      check.oversized === 401 &&
      check.correct === 200,
  );

  result = {
    port,
    endpoints,
    checks,
    metrics,
    summaryPathRedaction,
    health,
    sessionStatus,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      allAdminProtected &&
      summaryPathRedaction.ok &&
      metrics.sundermere_admin_auth_rejected_total === endpoints.length * 3 &&
      health === "ok" &&
      sessionStatus === 200,
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
      ADMIN_TOKEN: adminToken,
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

async function fetchStatus(endpoint, token, options = {}) {
  const headers = {};
  if (token) {
    headers["x-admin-token"] = token;
  }
  const response = await fetch(`${httpUrl}${endpoint}`, {
    ...options,
    headers,
  });
  await response.arrayBuffer();
  return response.status;
}

async function fetchText(endpoint) {
  const response = await fetch(`${httpUrl}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.text();
}

async function fetchJson(endpoint, token) {
  const headers = {};
  if (token) {
    headers["x-admin-token"] = token;
  }
  const response = await fetch(`${httpUrl}${endpoint}`, { headers });
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.json();
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
