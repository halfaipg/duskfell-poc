import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4118);
const runtimeDir = path.resolve("var", "metrics-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;

const requiredMetrics = [
  "sundermere_active_connections",
  "sundermere_ws_connections_total",
  "sundermere_ws_messages_in_total",
  "sundermere_ws_messages_rejected_total",
  "sundermere_ws_messages_out_total",
  "sundermere_ws_snapshots_sent_total",
  "sundermere_ws_snapshot_payload_rejected_total",
  "sundermere_ws_snapshot_players_last",
  "sundermere_ws_snapshot_players_max",
  "sundermere_ws_snapshot_objects_last",
  "sundermere_ws_snapshot_objects_max",
  "sundermere_ws_bytes_out_total",
  "sundermere_ws_message_bytes_last",
  "sundermere_ws_message_bytes_max",
  "sundermere_ws_snapshot_bytes_last",
  "sundermere_ws_snapshot_bytes_max",
  "sundermere_ws_send_errors_total",
  "sundermere_ws_heartbeat_pings_total",
  "sundermere_ws_idle_timeouts_total",
  "sundermere_session_tickets_issued_total",
  "sundermere_session_ticket_rejected_total",
  "sundermere_session_ticket_capacity_rejected_total",
  "sundermere_session_request_invalid_total",
  "sundermere_session_issue_rate_limited_total",
  "sundermere_session_account_rate_limited_total",
  "sundermere_session_draining_rejected_total",
  "sundermere_session_display_name_invalid_total",
  "sundermere_session_display_name_conflict_total",
  "sundermere_account_auth_rejected_total",
  "sundermere_admin_auth_rejected_total",
  "sundermere_metrics_auth_rejected_total",
  "sundermere_origin_rejected_total",
  "sundermere_ws_capacity_rejected_total",
  "sundermere_ws_peer_capacity_rejected_total",
  "sundermere_ws_account_capacity_rejected_total",
  "sundermere_admin_snapshot_payload_rejected_total",
  "sundermere_durable_journal_persist_failed_total",
  "sundermere_durable_settlement_persist_failed_total",
  "sundermere_settlement_queue_full_total",
  "sundermere_settlement_queue_closed_total",
  "sundermere_tick_duration_last_us",
  "sundermere_tick_duration_max_us",
  "sundermere_tick_overruns_total",
  "sundermere_tick",
  "sundermere_tick_budget_us",
  "sundermere_players",
  "sundermere_journal_events",
  "sundermere_journal_retained_capacity",
  "sundermere_journal_replayed_total_events",
  "sundermere_journal_last_sequence",
  "sundermere_journal_sequence_anomalies",
  "sundermere_max_journal_bytes",
  "sundermere_settlement_pending_jobs",
  "sundermere_settlement_confirmed_jobs",
  "sundermere_settlement_owned_assets",
  "sundermere_settlement_outbox_events",
  "sundermere_settlement_queue_capacity",
  "sundermere_settlement_queue_max_capacity",
  "sundermere_max_settlement_outbox_bytes",
  "sundermere_max_durable_line_bytes",
  "sundermere_durable_sync_writes",
  "sundermere_content_objects",
  "sundermere_max_content_objects",
  "sundermere_session_pending_tickets",
  "sundermere_session_ticket_capacity",
  "sundermere_session_issue_rate_limit_per_minute",
  "sundermere_session_issue_rate_limit_burst",
  "sundermere_session_issue_rate_limit_clients",
  "sundermere_session_issue_rate_limit_max_clients",
  "sundermere_account_session_rate_limit_per_minute",
  "sundermere_account_session_rate_limit_burst",
  "sundermere_account_session_rate_limit_subjects",
  "sundermere_account_session_rate_limit_max_subjects",
  "sundermere_max_active_connections",
  "sundermere_max_connections_per_ip",
  "sundermere_active_connection_ips",
  "sundermere_max_connections_per_account",
  "sundermere_active_connection_accounts",
  "sundermere_ws_heartbeat_seconds",
  "sundermere_snapshot_interval_ms",
  "sundermere_interest_radius_units",
  "sundermere_max_snapshot_bytes",
  "sundermere_max_admin_snapshot_bytes",
  "sundermere_ws_idle_timeout_seconds",
  "sundermere_ws_max_text_bytes",
  "sundermere_ws_message_burst",
  "sundermere_ws_message_refill_per_second",
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
  "sundermere_dev_account_token_configured",
  "sundermere_account_auth_mode_dev_token",
  "sundermere_account_auth_mode_jwt_hs256",
  "sundermere_account_jwt_issuer_configured",
  "sundermere_account_jwt_audience_configured",
  "sundermere_chain_enabled",
  "sundermere_http_body_limit_bytes",
  "sundermere_admin_event_limit_cap",
];

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  const initialMetricsText = await fetchText("/metrics");
  const initialMetrics = parseMetrics(initialMetricsText, requiredMetrics);
  const session = await issueSession();
  const afterSessionText = await fetchText("/metrics");
  const afterSessionMetrics = parseMetrics(afterSessionText, requiredMetrics);

  const expectedInitialValues = {
    sundermere_active_connections: 0,
    sundermere_ws_connections_total: 0,
    sundermere_ws_messages_in_total: 0,
    sundermere_ws_messages_rejected_total: 0,
    sundermere_ws_messages_out_total: 0,
    sundermere_ws_snapshots_sent_total: 0,
    sundermere_ws_snapshot_payload_rejected_total: 0,
    sundermere_ws_snapshot_players_last: 0,
    sundermere_ws_snapshot_players_max: 0,
    sundermere_ws_snapshot_objects_last: 0,
    sundermere_ws_snapshot_objects_max: 0,
    sundermere_ws_bytes_out_total: 0,
    sundermere_ws_message_bytes_last: 0,
    sundermere_ws_message_bytes_max: 0,
    sundermere_ws_snapshot_bytes_last: 0,
    sundermere_ws_snapshot_bytes_max: 0,
    sundermere_ws_send_errors_total: 0,
    sundermere_ws_heartbeat_pings_total: 0,
    sundermere_ws_idle_timeouts_total: 0,
    sundermere_session_tickets_issued_total: 0,
    sundermere_session_ticket_rejected_total: 0,
    sundermere_session_ticket_capacity_rejected_total: 0,
    sundermere_session_request_invalid_total: 0,
    sundermere_session_issue_rate_limited_total: 0,
    sundermere_session_account_rate_limited_total: 0,
    sundermere_session_draining_rejected_total: 0,
    sundermere_session_display_name_invalid_total: 0,
    sundermere_session_display_name_conflict_total: 0,
    sundermere_account_auth_rejected_total: 0,
    sundermere_admin_auth_rejected_total: 0,
    sundermere_metrics_auth_rejected_total: 0,
    sundermere_origin_rejected_total: 0,
    sundermere_ws_capacity_rejected_total: 0,
    sundermere_ws_peer_capacity_rejected_total: 0,
    sundermere_ws_account_capacity_rejected_total: 0,
    sundermere_admin_snapshot_payload_rejected_total: 0,
    sundermere_durable_journal_persist_failed_total: 0,
    sundermere_durable_settlement_persist_failed_total: 0,
    sundermere_settlement_queue_full_total: 0,
    sundermere_settlement_queue_closed_total: 0,
    sundermere_tick_budget_us: 50000,
    sundermere_players: 0,
    sundermere_journal_events: 0,
    sundermere_journal_retained_capacity: 10000,
    sundermere_journal_replayed_total_events: 0,
    sundermere_journal_last_sequence: 0,
    sundermere_journal_sequence_anomalies: 0,
    sundermere_max_journal_bytes: 16777216,
    sundermere_settlement_pending_jobs: 0,
    sundermere_settlement_confirmed_jobs: 0,
    sundermere_settlement_owned_assets: 0,
    sundermere_settlement_outbox_events: 0,
    sundermere_settlement_queue_capacity: 256,
    sundermere_settlement_queue_max_capacity: 256,
    sundermere_max_settlement_outbox_bytes: 16777216,
    sundermere_max_durable_line_bytes: 262144,
    sundermere_durable_sync_writes: 0,
    sundermere_content_objects: 5,
    sundermere_max_content_objects: 10000,
    sundermere_session_pending_tickets: 0,
    sundermere_session_ticket_capacity: 2,
    sundermere_session_issue_rate_limit_per_minute: 120,
    sundermere_session_issue_rate_limit_burst: 30,
    sundermere_session_issue_rate_limit_clients: 0,
    sundermere_session_issue_rate_limit_max_clients: 4096,
    sundermere_account_session_rate_limit_per_minute: 60,
    sundermere_account_session_rate_limit_burst: 10,
    sundermere_account_session_rate_limit_subjects: 0,
    sundermere_account_session_rate_limit_max_subjects: 4096,
    sundermere_max_active_connections: 7,
    sundermere_max_connections_per_ip: 7,
    sundermere_active_connection_ips: 0,
    sundermere_max_connections_per_account: 3,
    sundermere_active_connection_accounts: 0,
    sundermere_ws_heartbeat_seconds: 30,
    sundermere_snapshot_interval_ms: 50,
    sundermere_interest_radius_units: 520,
    sundermere_max_snapshot_bytes: 65536,
    sundermere_max_admin_snapshot_bytes: 262144,
    sundermere_ws_idle_timeout_seconds: 180,
    sundermere_ws_max_text_bytes: 4096,
    sundermere_ws_message_burst: 20,
    sundermere_ws_message_refill_per_second: 30,
    sundermere_public_deployment: 0,
    sundermere_deployment_profile_local: 1,
    sundermere_deployment_profile_shared_poc: 0,
    sundermere_deployment_profile_production: 0,
    sundermere_persistence_backend_jsonl: 1,
    sundermere_persistence_backend_postgres: 0,
    sundermere_admission_backend_in_memory: 1,
    sundermere_admission_backend_redis: 0,
    sundermere_draining: 0,
    sundermere_require_session: 1,
    sundermere_require_account: 0,
    sundermere_dev_account_token_configured: 0,
    sundermere_account_auth_mode_dev_token: 0,
    sundermere_account_auth_mode_jwt_hs256: 0,
    sundermere_account_jwt_issuer_configured: 0,
    sundermere_account_jwt_audience_configured: 0,
    sundermere_chain_enabled: 0,
    sundermere_http_body_limit_bytes: 4096,
    sundermere_admin_event_limit_cap: 200,
  };
  const expectedAfterSessionValues = {
    sundermere_session_tickets_issued_total: 1,
    sundermere_session_pending_tickets: 1,
    sundermere_session_ticket_capacity: 2,
  };

  const initialMatches = Object.entries(expectedInitialValues).every(
    ([name, value]) => initialMetrics[name] === value,
  );
  const afterSessionMatches = Object.entries(expectedAfterSessionValues).every(
    ([name, value]) => afterSessionMetrics[name] === value,
  );
  const tickTimingLooksSane =
    initialMetrics.sundermere_tick_duration_max_us >=
      initialMetrics.sundermere_tick_duration_last_us &&
    afterSessionMetrics.sundermere_tick_duration_max_us >=
      afterSessionMetrics.sundermere_tick_duration_last_us &&
    afterSessionMetrics.sundermere_tick_duration_max_us >=
      initialMetrics.sundermere_tick_duration_max_us;

  result = {
    port,
    sessionStatus: session.status,
    initialMetrics,
    afterSessionMetrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      requiredMetrics.every((name) => Number.isFinite(initialMetrics[name])) &&
      requiredMetrics.every((name) => Number.isFinite(afterSessionMetrics[name])) &&
      initialMatches &&
      tickTimingLooksSane &&
      session.status === 200 &&
      afterSessionMatches,
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
      REQUIRE_SESSION: "true",
      SESSION_TICKET_CAPACITY: "2",
      SESSION_TICKET_TTL_SECONDS: "60",
      MAX_ACTIVE_CONNECTIONS: "7",
      MAX_CONNECTIONS_PER_IP: "7",
      MAX_CONNECTIONS_PER_ACCOUNT: "3",
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
