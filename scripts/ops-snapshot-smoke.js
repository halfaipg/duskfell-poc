import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4138);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const runtimeDir = path.resolve("var", "ops-snapshot-smoke");
const adminToken = "ops-snapshot-admin-token-0001";
const metricsToken = "ops-snapshot-metrics-token-0001";
const accountToken = "ops-snapshot-account-token-0001";
const expectedGitSha = "ops-snapshot-smoke-sha";
const startedAt = performance.now();

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;

try {
  server = await startServer();
  const snapshot = await runSnapshot();
  const serialized = JSON.stringify(snapshot);
  const forbidden = [
    adminToken,
    metricsToken,
    accountToken,
    runtimeDir,
    `${runId}-journal.jsonl`,
    `${runId}-settlement-outbox.jsonl`,
  ].filter((value) => serialized.includes(value));

  result = {
    ok:
      forbidden.length === 0 &&
      snapshot.schemaVersion === "duskfell-ops-snapshot-v1" &&
      snapshot.health?.ok === true &&
      snapshot.readiness?.ready === true &&
      snapshot.runtime?.app?.buildGitSha === expectedGitSha &&
      snapshot.summary?.publicDeployment === true &&
      snapshot.summary?.requireSession === true &&
      snapshot.summary?.requireAccount === true &&
      snapshot.posture?.publicDeployment === true &&
      snapshot.posture?.requireSession === true &&
      snapshot.posture?.requireAccount === true &&
      snapshot.posture?.originAllowlistEnabled === true &&
      snapshot.posture?.notDraining === true &&
      snapshot.posture?.chainStubDisabled === true &&
      snapshot.posture?.sessionTicketCapacityAvailable === true &&
      snapshot.posture?.connectionCapacityAvailable === true &&
      snapshot.posture?.durablePersistenceHealthy === true &&
      snapshot.posture?.settlementQueueHasCapacity === true &&
      snapshot.summary?.journal?.pathBasename === "journal.jsonl" &&
      snapshot.summary?.settlement?.outboxPathBasename === "settlement-outbox.jsonl" &&
      snapshot.metrics?.sundermere_public_deployment === 1 &&
      snapshot.metrics?.sundermere_require_account === 1,
    port,
    forbidden,
    snapshot: {
      schemaVersion: snapshot.schemaVersion,
      health: snapshot.health,
      readiness: snapshot.readiness,
      app: snapshot.runtime?.app,
      posture: snapshot.posture,
      journal: snapshot.summary?.journal,
      settlement: snapshot.summary?.settlement,
      metrics: {
        sundermere_origin_allowlist_enabled: snapshot.metrics?.sundermere_origin_allowlist_enabled,
        sundermere_origin_allowed_origins: snapshot.metrics?.sundermere_origin_allowed_origins,
        sundermere_session_pending_tickets: snapshot.metrics?.sundermere_session_pending_tickets,
        sundermere_session_ticket_capacity: snapshot.metrics?.sundermere_session_ticket_capacity,
        sundermere_active_connections: snapshot.metrics?.sundermere_active_connections,
        sundermere_max_active_connections: snapshot.metrics?.sundermere_max_active_connections,
      },
      events: snapshot.events,
      ownership: snapshot.ownership,
    },
    elapsedMs: round(performance.now() - startedAt),
  };
} catch (err) {
  result = {
    ok: false,
    port,
    error: err.message,
    elapsedMs: round(performance.now() - startedAt),
  };
} finally {
  if (server) await stopServer(server);
}

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

async function startServer() {
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GIT_SHA: expectedGitSha,
      PUBLIC_DEPLOYMENT: "true",
      REQUIRE_SESSION: "true",
      REQUIRE_ACCOUNT: "true",
      ACCOUNT_AUTH_MODE: "dev-token",
      DEV_ACCOUNT_TOKEN: accountToken,
      ADMIN_TOKEN: adminToken,
      METRICS_TOKEN: metricsToken,
      ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
      DURABLE_SYNC_WRITES: "true",
      BIND_ADDR: `127.0.0.1:${port}`,
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth(child);
  return child;
}

async function runSnapshot() {
  const stdout = await runCapture("node", [
    "scripts/ops-snapshot.js",
    "--url",
    `http://127.0.0.1:${port}`,
    "--adminToken",
    adminToken,
    "--metricsToken",
    metricsToken,
    "--eventLimit",
    "20",
  ]);
  return JSON.parse(stdout);
}

async function waitForHealth(child) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited during startup with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok && (await response.text()) === "ok") return;
    } catch {
      // Retry until startup deadline.
    }
    await sleep(120);
  }
  throw new Error("server did not become healthy");
}

async function stopServer(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGINT");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3000).then(() => {
      if (child.exitCode == null) child.kill("SIGKILL");
    }),
  ]);
}

async function runCapture(command, args) {
  const child = spawn(command, args, {
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
    throw new Error(`${command} ${args.join(" ")} failed with code ${code}: ${stderr || stdout}`);
  }
  return stdout;
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
