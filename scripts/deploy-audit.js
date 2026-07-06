import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const baseUrl = new URL(args.url ?? "http://127.0.0.1:4107");
const profile = args.profile ?? "local";
const timeoutMs = Number(args.timeoutMs ?? 5000);
const adminToken = args.adminToken ?? process.env.ADMIN_TOKEN ?? null;
const metricsToken = args.metricsToken ?? process.env.METRICS_TOKEN ?? null;
const expectedGitSha = args.expectedGitSha ?? null;
const MAX_GIT_SHA_BYTES = 64;

if (!["local", "shared-poc"].includes(profile)) {
  throw new Error("--profile must be local or shared-poc");
}
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error("--timeoutMs must be positive");
}
if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
  throw new Error("--url must use http or https");
}

const startedAt = performance.now();
const checks = [];
const expectedGitShaValid = checkExpectedGitSha();

await checkText("healthz", "/healthz", "ok");
const ready = await checkReady();
const runtime = await checkRuntime();
const summary = await checkSummary();
const metrics = await checkMetrics();
checkRuntimePosture(runtime, summary);
checkMetricsPosture(metrics);

const result = {
  url: baseUrl.origin,
  profile,
  ok: checks.every((check) => check.ok),
  elapsedMs: round(performance.now() - startedAt),
  checks,
  runtime: runtime
    ? {
        app: runtime.app,
        content: runtime.content,
      }
    : null,
  ready: ready ? { ready: ready.ready, checks: ready.checks?.length ?? 0 } : null,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

async function checkText(name, path, expected) {
  try {
    const response = await fetchWithTimeout(path);
    const body = await response.text();
    add(name, response.ok && body === expected, `${response.status} ${body.slice(0, 80)}`);
  } catch (err) {
    add(name, false, err.message);
  }
}

async function checkReady() {
  try {
    const response = await fetchWithTimeout("/readyz", {
      headers: { accept: "application/json" },
    });
    const body = await response.json();
    const failed = body.checks?.filter((check) => check.ok !== true).map((check) => check.name) ?? [];
    add(
      "readyz",
      response.ok && body.ready === true && failed.length === 0,
      failed.length === 0 ? `${response.status} ready` : `${response.status} failed: ${failed.join(", ")}`,
    );
    return body;
  } catch (err) {
    add("readyz", false, err.message);
    return null;
  }
}

async function checkRuntime() {
  const protectedStatus = await protectedEndpointStatus(
    "admin-runtime-protected",
    "/admin/runtime",
    "x-admin-token",
    adminToken,
  );
  if (profile === "shared-poc" && protectedStatus !== 401) {
    add("admin-runtime-rejects-missing-token", false, `expected 401, got ${protectedStatus}`);
  }

  try {
    const response = await fetchWithTimeout("/admin/runtime", {
      headers: tokenHeaders("x-admin-token", adminToken),
    });
    const body = await response.json();
    add(
      "admin-runtime",
      response.ok &&
        body.app?.game === "Duskfell" &&
        body.app?.chain === "Base" &&
        body.app?.ticker === "$DUSK" &&
        body.assets?.sprites?.projection?.kind === "military-plan-oblique" &&
        body.assets?.terrain?.projection?.kind === "military-plan-oblique" &&
        imagesVerified(body.assets?.sprites?.images) &&
        imagesVerified(body.assets?.terrain?.images),
      `${response.status} game=${body.app?.game ?? "?"} git=${body.app?.buildGitSha ?? "none"}`,
    );
    if (profile === "shared-poc" || expectedGitSha != null) {
      add(
        "build-git-sha",
        expectedGitShaValid && body.app?.buildGitSha === expectedGitSha,
        `expected=${expectedGitSha} actual=${body.app?.buildGitSha ?? "missing"}`,
      );
    }
    return body;
  } catch (err) {
    add("admin-runtime", false, err.message);
    return null;
  }
}

async function checkSummary() {
  try {
    const response = await fetchWithTimeout("/admin/summary", {
      headers: tokenHeaders("x-admin-token", adminToken),
    });
    const body = await response.json();
    add(
      "admin-summary",
      response.ok &&
        body.content?.schemaVersion === "sundermere-world-v1" &&
        Number.isInteger(body.tick) &&
        Number.isFinite(body.players),
      `${response.status} public=${body.publicDeployment ?? "?"} requireSession=${body.requireSession ?? "?"} requireAccount=${body.requireAccount ?? "?"}`,
    );
    return body;
  } catch (err) {
    add("admin-summary", false, err.message);
    return null;
  }
}

async function checkMetrics() {
  const protectedStatus = await protectedEndpointStatus(
    "metrics-protected",
    "/metrics",
    "x-metrics-token",
    metricsToken,
  );
  if (profile === "shared-poc" && protectedStatus !== 401) {
    add("metrics-rejects-missing-token", false, `expected 401, got ${protectedStatus}`);
  }

  try {
    const response = await fetchWithTimeout("/metrics", {
      headers: tokenHeaders("x-metrics-token", metricsToken),
    });
    const text = await response.text();
    const metrics = parseMetrics(text);
    const required = [
      "sundermere_public_deployment",
      "sundermere_deployment_profile_local",
      "sundermere_deployment_profile_shared_poc",
      "sundermere_deployment_profile_production",
      "sundermere_persistence_backend_jsonl",
      "sundermere_persistence_backend_postgres",
      "sundermere_admission_backend_in_memory",
      "sundermere_admission_backend_redis",
      "sundermere_draining",
      "sundermere_require_session",
      "sundermere_require_account",
      "sundermere_chain_enabled",
      "sundermere_origin_allowlist_enabled",
      "sundermere_origin_allowed_origins",
      "sundermere_active_connections",
      "sundermere_max_active_connections",
      "sundermere_active_connection_accounts",
      "sundermere_max_connections_per_account",
      "sundermere_session_pending_tickets",
      "sundermere_session_ticket_capacity",
      "sundermere_durable_journal_persist_failed_total",
      "sundermere_durable_settlement_persist_failed_total",
      "sundermere_durable_sync_writes",
      "sundermere_settlement_queue_capacity",
      "sundermere_settlement_queue_max_capacity",
    ];
    const missing = required.filter((name) => !Object.hasOwn(metrics, name));
    add(
      "metrics",
      response.ok && missing.length === 0,
      missing.length === 0 ? `${response.status} required metrics present` : `${response.status} missing: ${missing.join(", ")}`,
    );
    return metrics;
  } catch (err) {
    add("metrics", false, err.message);
    return null;
  }
}

function checkRuntimePosture(runtime, summary) {
  if (!summary) return;
  if (profile === "shared-poc") {
    add(
      "deployment-profile-shared-poc",
      summary.deploymentProfile === "shared-poc",
      `deploymentProfile=${summary.deploymentProfile}`,
    );
    add(
      "persistence-backend-jsonl",
      summary.persistenceBackend === "jsonl",
      `persistenceBackend=${summary.persistenceBackend}`,
    );
    add(
      "admission-backend-in-memory",
      summary.admissionBackend === "in-memory",
      `admissionBackend=${summary.admissionBackend}`,
    );
    add("public-deployment-enabled", summary.publicDeployment === true, `publicDeployment=${summary.publicDeployment}`);
    add("not-draining", summary.draining === false, `draining=${summary.draining}`);
    add("strict-session-required", summary.requireSession === true, `requireSession=${summary.requireSession}`);
    add("account-gate-required", summary.requireAccount === true, `requireAccount=${summary.requireAccount}`);
    add("chain-stub-disabled", summary.chainEnabled === false, `chainEnabled=${summary.chainEnabled}`);
    add("durable-sync-writes-enabled", summary.durableSyncWrites === true, `durableSyncWrites=${summary.durableSyncWrites}`);
    add(
      "origin-allowlist-enabled",
      summary.originAllowlistEnabled === true && summary.originAllowedCount > 0,
      `enabled=${summary.originAllowlistEnabled} count=${summary.originAllowedCount}`,
    );
    add(
      "session-ticket-capacity-available",
      Number.isFinite(summary.sessionPendingTickets) &&
        Number.isFinite(summary.sessionTicketCapacity) &&
        summary.sessionPendingTickets < summary.sessionTicketCapacity,
      `pending=${summary.sessionPendingTickets} capacity=${summary.sessionTicketCapacity}`,
    );
    add(
      "connection-capacity-available",
      Number.isFinite(summary.activeConnections) &&
        Number.isFinite(summary.maxActiveConnections) &&
        summary.activeConnections < summary.maxActiveConnections,
      `active=${summary.activeConnections} max=${summary.maxActiveConnections}`,
    );
    add(
      "account-connection-capacity-available",
      Number.isFinite(summary.activeConnectionAccounts) &&
        Number.isFinite(summary.maxConnectionsPerAccount) &&
        summary.activeConnectionAccounts < summary.maxConnectionsPerAccount,
      `activeAccounts=${summary.activeConnectionAccounts} maxPerAccount=${summary.maxConnectionsPerAccount}`,
    );
  }
  if (runtime && summary.content) {
    add(
      "runtime-content-matches-summary",
      runtime.content?.contentHash === summary.content.contentHash &&
        runtime.content?.objectCount === summary.content.objectCount,
      `runtime=${runtime.content?.contentHash ?? "?"} summary=${summary.content.contentHash ?? "?"}`,
    );
  }
}

function checkMetricsPosture(metrics) {
  if (!metrics) return;
  if (profile === "shared-poc") {
    add(
      "metrics-deployment-profile-shared-poc",
      metrics.sundermere_deployment_profile_local === 0 &&
        metrics.sundermere_deployment_profile_shared_poc === 1 &&
        metrics.sundermere_deployment_profile_production === 0,
      `local=${metrics.sundermere_deployment_profile_local} shared=${metrics.sundermere_deployment_profile_shared_poc} production=${metrics.sundermere_deployment_profile_production}`,
    );
    add(
      "metrics-persistence-backend-jsonl",
      metrics.sundermere_persistence_backend_jsonl === 1 &&
        metrics.sundermere_persistence_backend_postgres === 0,
      `jsonl=${metrics.sundermere_persistence_backend_jsonl} postgres=${metrics.sundermere_persistence_backend_postgres}`,
    );
    add(
      "metrics-admission-backend-in-memory",
      metrics.sundermere_admission_backend_in_memory === 1 &&
        metrics.sundermere_admission_backend_redis === 0,
      `inMemory=${metrics.sundermere_admission_backend_in_memory} redis=${metrics.sundermere_admission_backend_redis}`,
    );
    add("metrics-public-deployment", metrics.sundermere_public_deployment === 1, `value=${metrics.sundermere_public_deployment}`);
    add("metrics-not-draining", metrics.sundermere_draining === 0, `value=${metrics.sundermere_draining}`);
    add("metrics-require-session", metrics.sundermere_require_session === 1, `value=${metrics.sundermere_require_session}`);
    add("metrics-require-account", metrics.sundermere_require_account === 1, `value=${metrics.sundermere_require_account}`);
    add("metrics-chain-disabled", metrics.sundermere_chain_enabled === 0, `value=${metrics.sundermere_chain_enabled}`);
    add("metrics-durable-sync-writes", metrics.sundermere_durable_sync_writes === 1, `value=${metrics.sundermere_durable_sync_writes}`);
    add(
      "metrics-origin-allowlist-enabled",
      metrics.sundermere_origin_allowlist_enabled === 1 &&
        metrics.sundermere_origin_allowed_origins > 0,
      `enabled=${metrics.sundermere_origin_allowlist_enabled} count=${metrics.sundermere_origin_allowed_origins}`,
    );
    add(
      "metrics-session-ticket-capacity-available",
      metrics.sundermere_session_pending_tickets < metrics.sundermere_session_ticket_capacity,
      `pending=${metrics.sundermere_session_pending_tickets} capacity=${metrics.sundermere_session_ticket_capacity}`,
    );
    add(
      "metrics-connection-capacity-available",
      metrics.sundermere_active_connections < metrics.sundermere_max_active_connections,
      `active=${metrics.sundermere_active_connections} max=${metrics.sundermere_max_active_connections}`,
    );
    add(
      "metrics-account-connection-capacity-available",
      metrics.sundermere_active_connection_accounts < metrics.sundermere_max_connections_per_account,
      `activeAccounts=${metrics.sundermere_active_connection_accounts} maxPerAccount=${metrics.sundermere_max_connections_per_account}`,
    );
  }
  add(
    "durable-persistence-healthy",
    metrics.sundermere_durable_journal_persist_failed_total === 0 &&
      metrics.sundermere_durable_settlement_persist_failed_total === 0,
    `journalFailures=${metrics.sundermere_durable_journal_persist_failed_total} settlementFailures=${metrics.sundermere_durable_settlement_persist_failed_total}`,
  );
  add(
    "settlement-queue-has-capacity",
    metrics.sundermere_settlement_queue_capacity > 0,
    `capacity=${metrics.sundermere_settlement_queue_capacity}/${metrics.sundermere_settlement_queue_max_capacity}`,
  );
}

function checkExpectedGitSha() {
  if (profile !== "shared-poc") {
    add("expected-build-git-sha-optional", true, "skipped outside shared-poc profile");
    return true;
  }

  const present = typeof expectedGitSha === "string" && expectedGitSha.length > 0;
  const bounded = present && Buffer.byteLength(expectedGitSha) <= MAX_GIT_SHA_BYTES;
  const formatted = present && /^[0-9a-f]{7,64}$/iu.test(expectedGitSha);
  const notUnknown = present && expectedGitSha.toLowerCase() !== "unknown";
  add("expected-build-git-sha-present", present, "shared-poc audit requires --expectedGitSha");
  add(
    "expected-build-git-sha-bounded",
    bounded,
    `--expectedGitSha must be at most ${MAX_GIT_SHA_BYTES} bytes`,
  );
  add(
    "expected-build-git-sha-format",
    formatted,
    "--expectedGitSha must be a 7-64 character hexadecimal Git revision",
  );
  add(
    "expected-build-git-sha-not-unknown",
    notUnknown,
    "--expectedGitSha must not use the Dockerfile unknown default",
  );
  return present && bounded && formatted && notUnknown;
}

async function protectedEndpointStatus(name, path, header, token) {
  if (profile !== "shared-poc") {
    add(name, true, "skipped outside shared-poc profile");
    return null;
  }
  if (!token) {
    add(name, false, `${header} token required for shared-poc audit`);
    return null;
  }
  try {
    const response = await fetchWithTimeout(path);
    await response.arrayBuffer();
    add(name, response.status === 401, `missing-token status=${response.status}`);
    return response.status;
  } catch (err) {
    add(name, false, err.message);
    return null;
  }
}

function imagesVerified(images) {
  return (
    Array.isArray(images) &&
    images.length > 0 &&
    images.every(
      (image) =>
        image.sha256Verified === true &&
        typeof image.sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(image.sha256) &&
        Number.isInteger(image.bytes) &&
        image.bytes > 0,
    )
  );
}

function parseMetrics(text) {
  const metrics = {};
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+(-?\d+(?:\.\d+)?)$/);
    if (match) metrics[match[1]] = Number(match[2]);
  }
  return metrics;
}

async function fetchWithTimeout(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(new URL(path, baseUrl), {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function tokenHeaders(header, token) {
  return token ? { [header]: token, accept: "application/json" } : { accept: "application/json" };
}

function add(name, ok, detail) {
  checks.push({ name, ok, detail });
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

function round(value) {
  return Math.round(value * 100) / 100;
}
