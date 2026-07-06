import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4120);
const runtimeDir = path.resolve("var", "readiness-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  const health = await fetchText("/healthz");
  const initialReady = await fetchReadiness();
  const session = await issueSession();
  const saturatedReady = await fetchReadiness();
  const readinessText = JSON.stringify({ initialReady, saturatedReady });
  const readinessPathRedaction = {
    absoluteRuntimeDirAbsent:
      !readinessText.includes(runtimeDir) &&
      !readinessText.includes(journalPath) &&
      !readinessText.includes(outboxPath),
    ok:
      !readinessText.includes(runtimeDir) &&
      !readinessText.includes(journalPath) &&
      !readinessText.includes(outboxPath),
  };

  result = {
    port,
    health,
    sessionStatus: session.status,
    initialReady,
    saturatedReady,
    readinessPathRedaction,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      health === "ok" &&
      readinessPathRedaction.ok &&
      session.status === 200 &&
      initialReady.status === 200 &&
      initialReady.body.ready === true &&
      hasCheck(initialReady.body, "persistenceBackendActive", true) &&
      hasCheck(initialReady.body, "admissionBackendActive", true) &&
      hasCheck(initialReady.body, "settlementQueueOpen", true) &&
      hasCheck(initialReady.body, "settlementQueueCapacityAvailable", true) &&
      hasCheck(initialReady.body, "journalDirWritable", true) &&
      hasCheck(initialReady.body, "settlementOutboxDirWritable", true) &&
      hasCheck(initialReady.body, "durablePersistenceHealthy", true) &&
      hasCheck(initialReady.body, "sessionTicketCapacityAvailable", true) &&
      saturatedReady.status === 503 &&
      saturatedReady.body.ready === false &&
      hasCheck(saturatedReady.body, "persistenceBackendActive", true) &&
      hasCheck(saturatedReady.body, "admissionBackendActive", true) &&
      hasCheck(saturatedReady.body, "settlementQueueOpen", true) &&
      hasCheck(saturatedReady.body, "settlementQueueCapacityAvailable", true) &&
      hasCheck(saturatedReady.body, "journalDirWritable", true) &&
      hasCheck(saturatedReady.body, "settlementOutboxDirWritable", true) &&
      hasCheck(saturatedReady.body, "durablePersistenceHealthy", true) &&
      hasCheck(saturatedReady.body, "sessionTicketCapacityAvailable", false),
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
      JOURNAL_PATH: journalPath,
      SETTLEMENT_OUTBOX_PATH: outboxPath,
      REQUIRE_SESSION: "true",
      SESSION_TICKET_CAPACITY: "1",
      SESSION_TICKET_TTL_SECONDS: "60",
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
    headers: {
      accept: "application/json",
    },
  });
  await response.arrayBuffer();
  return {
    status: response.status,
  };
}

async function fetchReadiness() {
  const response = await fetch(`${httpUrl}/readyz`, {
    headers: {
      accept: "application/json",
    },
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

function hasCheck(body, name, ok) {
  return body.checks?.some((check) => check.name === name && check.ok === ok) === true;
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
