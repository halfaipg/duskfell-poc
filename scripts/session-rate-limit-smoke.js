import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4124);
const runtimeDir = path.resolve("var", "session-rate-limit-smoke");
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
  const first = await issueSession({ name: "Bad<script>" });
  const second = await issueSession();
  const third = await issueSession();
  const summary = await fetchJson("/admin/summary");
  const metrics = parseMetrics(await fetchText("/metrics"), [
    "sundermere_session_pending_tickets",
    "sundermere_session_tickets_issued_total",
    "sundermere_session_issue_rate_limited_total",
    "sundermere_session_display_name_invalid_total",
    "sundermere_session_issue_rate_limit_per_minute",
    "sundermere_session_issue_rate_limit_burst",
    "sundermere_session_issue_rate_limit_clients",
    "sundermere_session_issue_rate_limit_max_clients",
  ]);

  result = {
    port,
    statuses: [first.status, second.status, third.status],
    thirdBody: third.body,
    summary: {
      sessionPendingTickets: summary.sessionPendingTickets,
      sessionTicketCapacity: summary.sessionTicketCapacity,
      sessionIssueRateLimitPerMinute: summary.sessionIssueRateLimitPerMinute,
      sessionIssueRateLimitBurst: summary.sessionIssueRateLimitBurst,
      sessionIssueRateLimitClients: summary.sessionIssueRateLimitClients,
      sessionIssueRateLimitMaxClients: summary.sessionIssueRateLimitMaxClients,
    },
    metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      first.status === 400 &&
      first.body.includes("invalid-player-name") &&
      second.status === 200 &&
      third.status === 429 &&
      summary.sessionPendingTickets === 1 &&
      summary.sessionTicketCapacity === 10 &&
      summary.sessionIssueRateLimitPerMinute === 60 &&
      summary.sessionIssueRateLimitBurst === 2 &&
      summary.sessionIssueRateLimitClients === 1 &&
      summary.sessionIssueRateLimitMaxClients === 3 &&
      metrics.sundermere_session_pending_tickets === 1 &&
      metrics.sundermere_session_tickets_issued_total === 1 &&
      metrics.sundermere_session_issue_rate_limited_total === 1 &&
      metrics.sundermere_session_display_name_invalid_total === 1 &&
      metrics.sundermere_session_issue_rate_limit_per_minute === 60 &&
      metrics.sundermere_session_issue_rate_limit_burst === 2 &&
      metrics.sundermere_session_issue_rate_limit_clients === 1 &&
      metrics.sundermere_session_issue_rate_limit_max_clients === 3,
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
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
      SESSION_TICKET_CAPACITY: "10",
      SESSION_TICKET_TTL_SECONDS: "60",
      SESSION_ISSUE_RATE_LIMIT_PER_MINUTE: "60",
      SESSION_ISSUE_RATE_LIMIT_BURST: "2",
      SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS: "3",
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

async function issueSession(payload) {
  const headers = {
    accept: "application/json",
  };
  const request = {
    method: "POST",
    headers,
  };
  if (payload) {
    headers["content-type"] = "application/json";
    request.body = JSON.stringify(payload);
  }
  const response = await fetch(`${httpUrl}/api/session`, {
    ...request,
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
