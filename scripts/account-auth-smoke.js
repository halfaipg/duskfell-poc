import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4158);
const runtimeDir = path.resolve("var", "account-auth-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;
const accountToken = `account-auth-${runId}`;
const oversizedToken = "x".repeat(5000);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();

  const missing = await issueSession();
  const wrong = await issueSession({
    authorization: "Bearer wrong-account-token",
  });
  const oversized = await issueSession({
    authorization: `Bearer ${oversizedToken}`,
  });
  const invalidBodyWithoutAuth = await issueSession({
    body: "not-json",
    contentType: "application/json",
  });
  const correct = await issueSession({
    authorization: `Bearer ${accountToken}`,
    body: JSON.stringify({ name: "Account_7" }),
    contentType: "application/json",
  });
  const summary = await fetchJson("/admin/summary");
  const metrics = parseMetrics(await fetchText("/metrics"), [
    "sundermere_account_auth_rejected_total",
    "sundermere_session_request_invalid_total",
    "sundermere_session_tickets_issued_total",
    "sundermere_session_pending_tickets",
    "sundermere_require_account",
    "sundermere_dev_account_token_configured",
    "sundermere_account_auth_mode_dev_token",
    "sundermere_account_auth_mode_jwt_hs256",
  ]);

  result = {
    port,
    statuses: {
      missing: missing.status,
      wrong: wrong.status,
      oversized: oversized.status,
      invalidBodyWithoutAuth: invalidBodyWithoutAuth.status,
      correct: correct.status,
    },
    correctBody: correct.body,
    summary: {
      requireAccount: summary.requireAccount,
      accountAuthMode: summary.accountAuthMode,
      devAccountTokenConfigured: summary.devAccountTokenConfigured,
      sessionPendingTickets: summary.sessionPendingTickets,
    },
    metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      missing.status === 401 &&
      missing.body === "invalid account token" &&
      wrong.status === 401 &&
      wrong.body === "invalid account token" &&
      oversized.status === 401 &&
      oversized.body === "invalid account token" &&
      invalidBodyWithoutAuth.status === 401 &&
      correct.status === 200 &&
      correct.body?.displayName === "Account_7" &&
      correct.body?.requireAccount === true &&
      summary.requireAccount === true &&
      summary.accountAuthMode === "dev-token" &&
      summary.devAccountTokenConfigured === true &&
      summary.sessionPendingTickets === 1 &&
      metrics.sundermere_account_auth_rejected_total === 4 &&
      metrics.sundermere_session_request_invalid_total === 0 &&
      metrics.sundermere_session_tickets_issued_total === 1 &&
      metrics.sundermere_session_pending_tickets === 1 &&
      metrics.sundermere_require_account === 1 &&
      metrics.sundermere_dev_account_token_configured === 1 &&
      metrics.sundermere_account_auth_mode_dev_token === 1 &&
      metrics.sundermere_account_auth_mode_jwt_hs256 === 0,
  };
} catch (err) {
  result = {
    port,
    elapsedMs: round(performance.now() - startedAt),
    ok: false,
    error: err.message,
    serverExitCode: server?.exitCode ?? null,
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
      REQUIRE_ACCOUNT: "true",
      DEV_ACCOUNT_TOKEN: accountToken,
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

async function issueSession(options = {}) {
  const headers = {
    accept: "application/json",
  };
  if (options.authorization) {
    headers.authorization = options.authorization;
  }
  if (options.contentType) {
    headers["content-type"] = options.contentType;
  }
  const response = await fetch(`${httpUrl}/api/session`, {
    method: "POST",
    headers,
    body: options.body,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: parseMaybeJson(text) ?? text,
  };
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

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
