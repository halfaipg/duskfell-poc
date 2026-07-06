import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4119);
const metricsToken = args.metricsToken ?? `metrics-smoke-${Date.now()}`;
const oversizedToken = "x".repeat(5000);
const runtimeDir = path.resolve("var", "metrics-auth-smoke");
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
  const missing = await fetchStatus("/metrics");
  const wrong = await fetchStatus("/metrics", "wrong-token");
  const oversized = await fetchStatus("/metrics", oversizedToken);
  const correctResponse = await fetchMetrics(metricsToken);
  const metrics = parseMetrics(correctResponse.text, ["sundermere_metrics_auth_rejected_total"]);
  const health = await fetchText("/healthz");
  const sessionStatus = await fetchStatus("/api/session", null, { method: "POST" });

  result = {
    port,
    missing,
    wrong,
    oversized,
    correct: correctResponse.status,
    metrics,
    health,
    sessionStatus,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      missing === 401 &&
      wrong === 401 &&
      oversized === 401 &&
      correctResponse.status === 200 &&
      metrics.sundermere_metrics_auth_rejected_total === 3 &&
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
      BIND_ADDR: `127.0.0.1:${port}`,
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
      METRICS_TOKEN: metricsToken,
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

async function fetchStatus(endpoint, token, options = {}) {
  const headers = {};
  if (token) {
    headers["x-metrics-token"] = token;
  }
  const response = await fetch(`${httpUrl}${endpoint}`, {
    ...options,
    headers,
  });
  await response.arrayBuffer();
  return response.status;
}

async function fetchMetrics(token) {
  const headers = {};
  if (token) {
    headers["x-metrics-token"] = token;
  }
  const response = await fetch(`${httpUrl}/metrics`, { headers });
  return {
    status: response.status,
    text: await response.text(),
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
