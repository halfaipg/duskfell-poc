import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { parseSmokeConfig, round } from "./public-deployment-smoke/config.js";
import { fetchJson, fetchStatus, fetchText, parseMetric } from "./public-deployment-smoke/http.js";
import { startServer, stopServer } from "./public-deployment-smoke/server.js";
import { runStartupGuards } from "./public-deployment-smoke/startup-cases.js";

const context = parseSmokeConfig(process.argv.slice(2));
const startedAt = performance.now();

await mkdir(context.runtimeDir, { recursive: true });

let server = null;
let result;

try {
  const startupGuards = await runStartupGuards(context);

  server = await startServer(context, {
    DEPLOYMENT_PROFILE: "shared-poc",
    PERSISTENCE_BACKEND: "jsonl",
    ADMISSION_BACKEND: "in-memory",
    PUBLIC_DEPLOYMENT: "true",
    REQUIRE_SESSION: "true",
    REQUIRE_ACCOUNT: "true",
    DEV_ACCOUNT_TOKEN: context.accountToken,
    ADMIN_TOKEN: context.adminToken,
    METRICS_TOKEN: context.metricsToken,
    ALLOWED_ORIGINS: context.allowedOrigin,
    DURABLE_SYNC_WRITES: "true",
  });

  const health = await fetchText(context, "/healthz");
  const adminMissing = await fetchStatus(context, "/admin/summary");
  const adminSummary = await fetchJson(context, "/admin/summary", {
    headers: { "x-admin-token": context.adminToken },
  });
  const metricsMissing = await fetchStatus(context, "/metrics");
  const metricsText = await fetchText(context, "/metrics", {
    headers: { "x-metrics-token": context.metricsToken },
  });
  const sessionMissingOrigin = await fetchStatus(context, "/api/session", {
    method: "POST",
  });
  const sessionAllowedOrigin = await fetchStatus(context, "/api/session", {
    method: "POST",
    headers: { origin: context.allowedOrigin },
  });
  const sessionAllowedAccount = await fetchStatus(context, "/api/session", {
    method: "POST",
    headers: { origin: context.allowedOrigin, authorization: `Bearer ${context.accountToken}` },
  });

  result = {
    port: context.port,
    ...startupGuards,
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
    metrics: readMetrics(metricsText),
    sessionMissingOrigin,
    sessionAllowedOrigin,
    sessionAllowedAccount,
    elapsedMs: round(performance.now() - startedAt),
  };
  result.ok = smokePassed(result, adminSummary, metricsText);
} finally {
  if (server) {
    await stopServer(server);
  }
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) {
  process.exitCode = 1;
}

function readMetrics(metricsText) {
  return {
    sundermere_public_deployment: parseMetric(metricsText, "sundermere_public_deployment"),
    sundermere_deployment_profile_shared_poc: parseMetric(
      metricsText,
      "sundermere_deployment_profile_shared_poc",
    ),
    sundermere_persistence_backend_jsonl: parseMetric(metricsText, "sundermere_persistence_backend_jsonl"),
    sundermere_persistence_backend_postgres: parseMetric(
      metricsText,
      "sundermere_persistence_backend_postgres",
    ),
    sundermere_admission_backend_in_memory: parseMetric(
      metricsText,
      "sundermere_admission_backend_in_memory",
    ),
    sundermere_admission_backend_redis: parseMetric(metricsText, "sundermere_admission_backend_redis"),
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
  };
}

function smokePassed(result, adminSummary, metricsText) {
  return (
    result.missingDeploymentProfileStartup.ok &&
    result.missingPersistenceBackendStartup.ok &&
    result.missingAdmissionBackendStartup.ok &&
    result.refusedStartup.ok &&
    result.weakTokenStartup.ok &&
    result.placeholderTokenStartup.ok &&
    result.oversizedTokenStartup.ok &&
    result.unsyncedDurableStartup.ok &&
    result.health === "ok" &&
    result.adminMissing === 401 &&
    adminSummary.publicDeployment === true &&
    adminSummary.deploymentProfile === "shared-poc" &&
    adminSummary.persistenceBackend === "jsonl" &&
    adminSummary.admissionBackend === "in-memory" &&
    adminSummary.requireSession === true &&
    adminSummary.requireAccount === true &&
    adminSummary.devAccountTokenConfigured === true &&
    adminSummary.originAllowlistEnabled === true &&
    adminSummary.originAllowedCount === 1 &&
    result.metricsMissing === 401 &&
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
    result.sessionMissingOrigin === 403 &&
    result.sessionAllowedOrigin === 401 &&
    result.sessionAllowedAccount === 200
  );
}
