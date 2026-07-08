import { fetchWithTimeout, protectedEndpointStatus, tokenHeaders } from "./request.js";

export async function checkMetrics(context) {
  const protectedStatus = await protectedEndpointStatus(
    context,
    "metrics-protected",
    "/metrics",
    "x-metrics-token",
    context.metricsToken,
  );
  if (context.profile === "shared-poc" && protectedStatus !== 401) {
    context.add("metrics-rejects-missing-token", false, `expected 401, got ${protectedStatus}`);
  }

  try {
    const response = await fetchWithTimeout(context, "/metrics", {
      headers: tokenHeaders("x-metrics-token", context.metricsToken),
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
    context.add(
      "metrics",
      response.ok && missing.length === 0,
      missing.length === 0 ? `${response.status} required metrics present` : `${response.status} missing: ${missing.join(", ")}`,
    );
    return metrics;
  } catch (err) {
    context.add("metrics", false, err.message);
    return null;
  }
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
