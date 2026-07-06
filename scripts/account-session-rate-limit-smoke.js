import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4164);
const runtimeDir = path.resolve("var", "account-session-rate-limit-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;
const secret = `account-session-rate-limit-secret-${runId}`;
const issuer = "https://identity.example";
const audience = "duskfell";
const subject = "acct:wallet:0xabc123";

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  const token = signJwt({
    sub: subject,
    iss: issuer,
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 120,
  });

  const invalidName = await issueSession(token, { name: "Bad<script>" });
  const valid = await issueSession(token, { name: "Rate_7" });
  const limited = await issueSession(token, { name: "Rate_8" });

  const [summary, metricsText] = await Promise.all([
    fetchJson("/admin/summary"),
    fetchText("/metrics"),
  ]);
  const metrics = parseMetrics(metricsText, [
    "sundermere_session_pending_tickets",
    "sundermere_session_tickets_issued_total",
    "sundermere_session_display_name_invalid_total",
    "sundermere_session_issue_rate_limited_total",
    "sundermere_session_account_rate_limited_total",
    "sundermere_account_session_rate_limit_per_minute",
    "sundermere_account_session_rate_limit_burst",
    "sundermere_account_session_rate_limit_subjects",
    "sundermere_account_session_rate_limit_max_subjects",
  ]);

  result = {
    port,
    statuses: {
      invalidName: invalidName.status,
      valid: valid.status,
      limited: limited.status,
    },
    limitedBody: limited.body,
    summary: {
      sessionPendingTickets: summary.sessionPendingTickets,
      accountSessionRateLimitPerMinute: summary.accountSessionRateLimitPerMinute,
      accountSessionRateLimitBurst: summary.accountSessionRateLimitBurst,
      accountSessionRateLimitSubjects: summary.accountSessionRateLimitSubjects,
      accountSessionRateLimitMaxSubjects: summary.accountSessionRateLimitMaxSubjects,
    },
    metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      invalidName.status === 400 &&
      invalidName.body.includes("invalid-player-name") &&
      valid.status === 200 &&
      valid.body?.accountSubject === subject &&
      limited.status === 429 &&
      limited.body === "account session issue rate limit exceeded" &&
      summary.sessionPendingTickets === 1 &&
      summary.accountSessionRateLimitPerMinute === 60 &&
      summary.accountSessionRateLimitBurst === 2 &&
      summary.accountSessionRateLimitSubjects === 1 &&
      summary.accountSessionRateLimitMaxSubjects === 3 &&
      metrics.sundermere_session_pending_tickets === 1 &&
      metrics.sundermere_session_tickets_issued_total === 1 &&
      metrics.sundermere_session_display_name_invalid_total === 1 &&
      metrics.sundermere_session_issue_rate_limited_total === 0 &&
      metrics.sundermere_session_account_rate_limited_total === 1 &&
      metrics.sundermere_account_session_rate_limit_per_minute === 60 &&
      metrics.sundermere_account_session_rate_limit_burst === 2 &&
      metrics.sundermere_account_session_rate_limit_subjects === 1 &&
      metrics.sundermere_account_session_rate_limit_max_subjects === 3,
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
      ACCOUNT_AUTH_MODE: "jwt-hs256",
      ACCOUNT_JWT_HS256_SECRET: secret,
      ACCOUNT_JWT_ISSUER: issuer,
      ACCOUNT_JWT_AUDIENCE: audience,
      SESSION_ISSUE_RATE_LIMIT_PER_MINUTE: "600",
      SESSION_ISSUE_RATE_LIMIT_BURST: "20",
      SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS: "8",
      ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE: "60",
      ACCOUNT_SESSION_RATE_LIMIT_BURST: "2",
      ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS: "3",
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth(child);
  return child;
}

async function issueSession(jwt, payload) {
  const response = await fetch(`${httpUrl}/api/session`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
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

function signJwt(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
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
