import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4129);
const runtimeDir = path.resolve("var", "public-deployment-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const adminToken = args.adminToken ?? `admin-public-${Date.now()}`;
const metricsToken = args.metricsToken ?? `metrics-public-${Date.now()}`;
const accountToken = args.accountToken ?? `account-public-${Date.now()}`;
const allowedOrigin = args.allowedOrigin ?? "https://play.example";
const httpUrl = `http://127.0.0.1:${port}`;

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  const missingDeploymentProfileStartup = await expectStartupFailure(
    {
      PUBLIC_DEPLOYMENT: "true",
    },
    ["DEPLOYMENT_PROFILE=shared-poc"],
  );
  const missingPersistenceBackendStartup = await expectStartupFailure(
    {
      DEPLOYMENT_PROFILE: "shared-poc",
      PUBLIC_DEPLOYMENT: "true",
      REQUIRE_SESSION: "true",
      REQUIRE_ACCOUNT: "true",
      DEV_ACCOUNT_TOKEN: accountToken,
      ADMIN_TOKEN: adminToken,
      METRICS_TOKEN: metricsToken,
      ALLOWED_ORIGINS: allowedOrigin,
      DURABLE_SYNC_WRITES: "true",
    },
    ["PERSISTENCE_BACKEND=jsonl"],
  );
  const missingAdmissionBackendStartup = await expectStartupFailure(
    {
      DEPLOYMENT_PROFILE: "shared-poc",
      PERSISTENCE_BACKEND: "jsonl",
      PUBLIC_DEPLOYMENT: "true",
      REQUIRE_SESSION: "true",
      REQUIRE_ACCOUNT: "true",
      DEV_ACCOUNT_TOKEN: accountToken,
      ADMIN_TOKEN: adminToken,
      METRICS_TOKEN: metricsToken,
      ALLOWED_ORIGINS: allowedOrigin,
      DURABLE_SYNC_WRITES: "true",
    },
    ["ADMISSION_BACKEND=in-memory"],
  );
  const refusedStartup = await expectStartupFailure({
    DEPLOYMENT_PROFILE: "shared-poc",
    PUBLIC_DEPLOYMENT: "true",
  });
  const weakTokenStartup = await expectStartupFailure(
    {
      DEPLOYMENT_PROFILE: "shared-poc",
      PUBLIC_DEPLOYMENT: "true",
      REQUIRE_SESSION: "true",
      REQUIRE_ACCOUNT: "true",
      DEV_ACCOUNT_TOKEN: "short-account",
      ADMIN_TOKEN: "short-admin",
      METRICS_TOKEN: "short-metrics",
      ALLOWED_ORIGINS: allowedOrigin,
    },
    ["DEV_ACCOUNT_TOKEN length", "ADMIN_TOKEN length", "METRICS_TOKEN length"],
  );
  const placeholderTokenStartup = await expectStartupFailure(
    {
      DEPLOYMENT_PROFILE: "shared-poc",
      PUBLIC_DEPLOYMENT: "true",
      REQUIRE_SESSION: "true",
      REQUIRE_ACCOUNT: "true",
      DEV_ACCOUNT_TOKEN: "replace-with-strong-account-token",
      ADMIN_TOKEN: "replace-with-strong-admin-token",
      METRICS_TOKEN: "metrics-token-placeholder-123",
      ALLOWED_ORIGINS: allowedOrigin,
    },
    [
      "DEV_ACCOUNT_TOKEN must not use placeholder text",
      "ADMIN_TOKEN must not use placeholder text",
      "METRICS_TOKEN must not use placeholder text",
    ],
  );
  const oversizedTokenStartup = await expectStartupFailure(
    {
      DEPLOYMENT_PROFILE: "shared-poc",
      PUBLIC_DEPLOYMENT: "true",
      REQUIRE_SESSION: "true",
      REQUIRE_ACCOUNT: "true",
      DEV_ACCOUNT_TOKEN: "a".repeat(4097),
      ADMIN_TOKEN: "b".repeat(4097),
      METRICS_TOKEN: "c".repeat(4097),
      ALLOWED_ORIGINS: allowedOrigin,
    },
    [
      "DEV_ACCOUNT_TOKEN length <= 4096 bytes",
      "ADMIN_TOKEN length <= 4096 bytes",
      "METRICS_TOKEN length <= 4096 bytes",
    ],
  );
  const unsyncedDurableStartup = await expectStartupFailure(
    {
      DEPLOYMENT_PROFILE: "shared-poc",
      PUBLIC_DEPLOYMENT: "true",
      REQUIRE_SESSION: "true",
      REQUIRE_ACCOUNT: "true",
      DEV_ACCOUNT_TOKEN: accountToken,
      ADMIN_TOKEN: adminToken,
      METRICS_TOKEN: metricsToken,
      ALLOWED_ORIGINS: allowedOrigin,
      DURABLE_SYNC_WRITES: "false",
    },
    ["DURABLE_SYNC_WRITES=true"],
  );

  server = await startServer({
    DEPLOYMENT_PROFILE: "shared-poc",
    PERSISTENCE_BACKEND: "jsonl",
    ADMISSION_BACKEND: "in-memory",
    PUBLIC_DEPLOYMENT: "true",
    REQUIRE_SESSION: "true",
    REQUIRE_ACCOUNT: "true",
    DEV_ACCOUNT_TOKEN: accountToken,
    ADMIN_TOKEN: adminToken,
    METRICS_TOKEN: metricsToken,
    ALLOWED_ORIGINS: allowedOrigin,
    DURABLE_SYNC_WRITES: "true",
  });

  const health = await fetchText("/healthz");
  const adminMissing = await fetchStatus("/admin/summary");
  const adminSummary = await fetchJson("/admin/summary", {
    headers: { "x-admin-token": adminToken },
  });
  const metricsMissing = await fetchStatus("/metrics");
  const metricsText = await fetchText("/metrics", {
    headers: { "x-metrics-token": metricsToken },
  });
  const sessionMissingOrigin = await fetchStatus("/api/session", {
    method: "POST",
  });
  const sessionAllowedOrigin = await fetchStatus("/api/session", {
    method: "POST",
    headers: { origin: allowedOrigin },
  });
  const sessionAllowedAccount = await fetchStatus("/api/session", {
    method: "POST",
    headers: { origin: allowedOrigin, authorization: `Bearer ${accountToken}` },
  });

  result = {
    port,
    missingDeploymentProfileStartup,
    missingPersistenceBackendStartup,
    missingAdmissionBackendStartup,
    refusedStartup,
    weakTokenStartup,
    placeholderTokenStartup,
    oversizedTokenStartup,
    unsyncedDurableStartup,
    health,
    adminMissing,
    adminSummary: {
      publicDeployment: adminSummary.publicDeployment,
      deploymentProfile: adminSummary.deploymentProfile,
      persistenceBackend: adminSummary.persistenceBackend,
      admissionBackend: adminSummary.admissionBackend,
      requireSession: adminSummary.requireSession,
      requireAccount: adminSummary.requireAccount,
      devAccountTokenConfigured: adminSummary.devAccountTokenConfigured,
      originAllowlistEnabled: adminSummary.originAllowlistEnabled,
      originAllowedCount: adminSummary.originAllowedCount,
    },
    metricsMissing,
    metrics: {
      sundermere_public_deployment: parseMetric(metricsText, "sundermere_public_deployment"),
      sundermere_deployment_profile_shared_poc: parseMetric(
        metricsText,
        "sundermere_deployment_profile_shared_poc",
      ),
      sundermere_persistence_backend_jsonl: parseMetric(
        metricsText,
        "sundermere_persistence_backend_jsonl",
      ),
      sundermere_persistence_backend_postgres: parseMetric(
        metricsText,
        "sundermere_persistence_backend_postgres",
      ),
      sundermere_admission_backend_in_memory: parseMetric(
        metricsText,
        "sundermere_admission_backend_in_memory",
      ),
      sundermere_admission_backend_redis: parseMetric(
        metricsText,
        "sundermere_admission_backend_redis",
      ),
      sundermere_require_session: parseMetric(metricsText, "sundermere_require_session"),
      sundermere_require_account: parseMetric(metricsText, "sundermere_require_account"),
      sundermere_dev_account_token_configured: parseMetric(
        metricsText,
        "sundermere_dev_account_token_configured",
      ),
      sundermere_origin_allowlist_enabled: parseMetric(
        metricsText,
        "sundermere_origin_allowlist_enabled",
      ),
    },
    sessionMissingOrigin,
    sessionAllowedOrigin,
    sessionAllowedAccount,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      missingDeploymentProfileStartup.ok &&
      missingPersistenceBackendStartup.ok &&
      missingAdmissionBackendStartup.ok &&
      refusedStartup.ok &&
      weakTokenStartup.ok &&
      placeholderTokenStartup.ok &&
      oversizedTokenStartup.ok &&
      unsyncedDurableStartup.ok &&
      health === "ok" &&
      adminMissing === 401 &&
      adminSummary.publicDeployment === true &&
      adminSummary.deploymentProfile === "shared-poc" &&
      adminSummary.persistenceBackend === "jsonl" &&
      adminSummary.admissionBackend === "in-memory" &&
      adminSummary.requireSession === true &&
      adminSummary.requireAccount === true &&
      adminSummary.devAccountTokenConfigured === true &&
      adminSummary.originAllowlistEnabled === true &&
      adminSummary.originAllowedCount === 1 &&
      metricsMissing === 401 &&
      parseMetric(metricsText, "sundermere_public_deployment") === 1 &&
      parseMetric(metricsText, "sundermere_deployment_profile_shared_poc") === 1 &&
      parseMetric(metricsText, "sundermere_persistence_backend_jsonl") === 1 &&
      parseMetric(metricsText, "sundermere_persistence_backend_postgres") === 0 &&
      parseMetric(metricsText, "sundermere_admission_backend_in_memory") === 1 &&
      parseMetric(metricsText, "sundermere_admission_backend_redis") === 0 &&
      parseMetric(metricsText, "sundermere_require_session") === 1 &&
      parseMetric(metricsText, "sundermere_require_account") === 1 &&
      parseMetric(metricsText, "sundermere_dev_account_token_configured") === 1 &&
      parseMetric(metricsText, "sundermere_origin_allowlist_enabled") === 1 &&
      sessionMissingOrigin === 403 &&
      sessionAllowedOrigin === 401 &&
      sessionAllowedAccount === 200,
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

async function expectStartupFailure(env, expectedOutput = ["PUBLIC_DEPLOYMENT"]) {
  const child = spawnServer("public-refused", env);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const exit = await waitForExit(child, 10000);
  const output = `${stdout}\n${stderr}`;
  const mentionedExpectedOutput = expectedOutput.every((needle) => output.includes(needle));
  return {
    code: exit.code,
    signal: exit.signal,
    mentionedPublicDeployment: output.includes("PUBLIC_DEPLOYMENT"),
    mentionedExpectedOutput,
    ok: exit.code !== 0 && mentionedExpectedOutput,
  };
}

async function startServer(env) {
  const child = spawnServer("public-ok", env);
  await waitForHealth(child);
  return child;
}

function spawnServer(name, env) {
  return spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      BIND_ADDR: `127.0.0.1:${port}`,
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-${name}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-${name}-settlement-outbox.jsonl`),
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
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

async function waitForExit(child, timeoutMs) {
  return Promise.race([
    new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
    sleep(timeoutMs).then(() => {
      child.kill("SIGKILL");
      return {
        code: child.exitCode,
        signal: "timeout",
      };
    }),
  ]);
}

async function fetchStatus(endpoint, options = {}) {
  const response = await fetch(`${httpUrl}${endpoint}`, options);
  await response.arrayBuffer();
  return response.status;
}

async function fetchText(endpoint, options = {}) {
  const response = await fetch(`${httpUrl}${endpoint}`, options);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.text();
}

async function fetchJson(endpoint, options = {}) {
  const response = await fetch(`${httpUrl}${endpoint}`, options);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.json();
}

function parseMetric(text, name) {
  const match = text.match(new RegExp(`^${name} ([0-9]+)$`, "m"));
  return match ? Number(match[1]) : Number.NaN;
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
