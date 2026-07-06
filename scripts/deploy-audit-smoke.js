import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4137);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const runtimeDir = path.resolve("var", "deploy-audit-smoke");
const adminToken = "deploy-audit-admin-token-0001";
const metricsToken = "deploy-audit-metrics-token-0001";
const accountToken = "deploy-audit-account-token-0001";
const expectedGitSha = "0123456789abcdef0123456789abcdef01234567";
const startedAt = performance.now();

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;

try {
  server = await startServer();
  const audit = await runAudit({ expectedGitSha });
  const missingExpectedGitShaAudit = await runAudit({});
  const expectedChecksPresent = [
    "expected-build-git-sha-format",
    "build-git-sha",
    "deployment-profile-shared-poc",
    "origin-allowlist-enabled",
    "durable-sync-writes-enabled",
    "session-ticket-capacity-available",
    "connection-capacity-available",
    "account-connection-capacity-available",
    "metrics-origin-allowlist-enabled",
    "metrics-deployment-profile-shared-poc",
    "metrics-durable-sync-writes",
    "metrics-session-ticket-capacity-available",
    "metrics-connection-capacity-available",
    "metrics-account-connection-capacity-available",
  ].every((name) => audit.checks?.some((check) => check.name === name && check.ok === true));
  const missingExpectedGitShaRejected =
    missingExpectedGitShaAudit.ok === false &&
    missingExpectedGitShaAudit.checks?.some(
      (check) => check.name === "expected-build-git-sha-present" && check.ok === false,
    ) &&
    missingExpectedGitShaAudit.checks?.some(
      (check) => check.name === "build-git-sha" && check.ok === false,
    );
  result = {
    ok: audit.ok && expectedChecksPresent && missingExpectedGitShaRejected,
    port,
    audit,
    expectedChecksPresent,
    missingExpectedGitShaRejected,
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
      DEPLOYMENT_PROFILE: "shared-poc",
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

async function runAudit({ expectedGitSha } = {}) {
  const args = [
    "scripts/deploy-audit.js",
    "--url",
    `http://127.0.0.1:${port}`,
    "--profile",
    "shared-poc",
    "--adminToken",
    adminToken,
    "--metricsToken",
    metricsToken,
  ];
  if (expectedGitSha != null) {
    args.push("--expectedGitSha", expectedGitSha);
  }
  const { stdout, stderr, code } = await runCapture("node", args);
  if (code !== 0 && !stdout.trim()) {
    throw new Error(`node ${args.join(" ")} failed with code ${code}: ${stderr}`);
  }
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
  return { stdout, stderr, code };
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
