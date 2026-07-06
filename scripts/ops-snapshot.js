import { writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const baseUrl = new URL(args.url ?? "http://127.0.0.1:4107");
const timeoutMs = Number(args.timeoutMs ?? 5000);
const adminToken = args.adminToken ?? process.env.ADMIN_TOKEN ?? null;
const metricsToken = args.metricsToken ?? process.env.METRICS_TOKEN ?? null;
const eventLimit = Number(args.eventLimit ?? 50);
const outPath = args.out ?? null;

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error("--timeoutMs must be positive");
}
if (!Number.isInteger(eventLimit) || eventLimit < 0 || eventLimit > 200) {
  throw new Error("--eventLimit must be an integer between 0 and 200");
}
if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
  throw new Error("--url must use http or https");
}

const startedAt = performance.now();

const [health, ready, runtime, summary, metricsText, events, ownership] = await Promise.all([
  fetchText("/healthz", {}),
  fetchJson("/readyz", {}),
  fetchJson("/admin/runtime", { headers: adminHeaders() }),
  fetchJson("/admin/summary", { headers: adminHeaders() }),
  fetchText("/metrics", { headers: metricsHeaders("text/plain") }),
  eventLimit === 0
    ? Promise.resolve([])
    : fetchJson(`/admin/events?limit=${eventLimit}`, { headers: adminHeaders() }),
  fetchJson("/admin/ownership", { headers: adminHeaders() }),
]);

const metrics = parseMetrics(metricsText.body);
const snapshot = {
  schemaVersion: "duskfell-ops-snapshot-v1",
  capturedAt: new Date().toISOString(),
  url: baseUrl.origin,
  elapsedMs: round(performance.now() - startedAt),
  health: {
    ok: health.status === 200 && health.body === "ok",
    status: health.status,
  },
  readiness: summarizeReady(ready.body),
  runtime: summarizeRuntime(runtime.body),
  summary: summarizeAdminSummary(summary.body),
  posture: summarizePosture(summary.body, metrics),
  metrics: summarizeMetrics(metrics),
  events: summarizeEvents(events.body ?? events),
  ownership: summarizeOwnership(ownership.body),
};

const output = `${JSON.stringify(snapshot, null, 2)}\n`;
if (outPath) {
  await writeFile(outPath, output, { mode: 0o600 });
}
process.stdout.write(output);

function summarizeReady(body) {
  const checks = Array.isArray(body?.checks) ? body.checks : [];
  return {
    ready: body?.ready === true,
    checkCount: checks.length,
    failedChecks: checks.filter((check) => check?.ok !== true).map((check) => check.name),
    content: body?.content ?? null,
  };
}

function summarizeRuntime(body) {
  return {
    app: body?.app ?? null,
    content: body?.content ?? null,
    assets: {
      sprites: summarizeAssetManifest(body?.assets?.sprites),
      terrain: summarizeAssetManifest(body?.assets?.terrain),
    },
  };
}

function summarizeAssetManifest(manifest) {
  if (!manifest) return null;
  return {
    schemaVersion: manifest.schemaVersion,
    manifestFingerprint: manifest.manifestFingerprint,
    manifestBytes: manifest.manifestBytes,
    maxManifestBytes: manifest.maxManifestBytes,
    maxImageBytes: manifest.maxImageBytes,
    projection: manifest.projection,
    entryCount: manifest.entryCount,
    images: Array.isArray(manifest.images)
      ? manifest.images.map((image) => ({
          id: image.id,
          image: image.image,
          sha256: image.sha256,
          sha256Verified: image.sha256Verified,
          bytes: image.bytes,
          approvalState: image.approvalState,
        }))
      : [],
  };
}

function summarizeAdminSummary(summary) {
  return {
    tick: summary?.tick,
    players: summary?.players,
    content: summary?.content ?? null,
    publicDeployment: summary?.publicDeployment,
    deploymentProfile: summary?.deploymentProfile,
    requireSession: summary?.requireSession,
    requireAccount: summary?.requireAccount,
    accountAuthMode: summary?.accountAuthMode,
    chainEnabled: summary?.chainEnabled,
    originAllowlistEnabled: summary?.originAllowlistEnabled,
    originAllowedCount: summary?.originAllowedCount,
    journal: {
      events: summary?.journalEvents,
      retainedCapacity: summary?.journalRetainedCapacity,
      replayedTotalEvents: summary?.journalReplayedTotalEvents,
      lastSequence: summary?.journalLastSequence,
      sequenceAnomalies: summary?.journalSequenceAnomalies,
      pathBasename: redactedDurableBasename(summary?.journalPath),
      maxBytes: summary?.maxJournalBytes,
    },
    settlement: {
      pending: summary?.settlementPending,
      confirmed: summary?.settlementConfirmed,
      ownedAssets: summary?.settlementOwnedAssets,
      outboxEvents: summary?.settlementOutboxEvents,
      outboxPathBasename: redactedDurableBasename(summary?.settlementOutboxPath),
      queueCapacity: summary?.settlementQueueCapacity,
      queueMaxCapacity: summary?.settlementQueueMaxCapacity,
      queueFullEvents: summary?.settlementQueueFullEvents,
      queueClosedEvents: summary?.settlementQueueClosedEvents,
      maxOutboxBytes: summary?.maxSettlementOutboxBytes,
    },
    durability: {
      syncWrites: summary?.durableSyncWrites,
      maxLineBytes: summary?.maxDurableLineBytes,
      journalPersistFailures: summary?.durableJournalPersistFailures,
      settlementPersistFailures: summary?.durableSettlementPersistFailures,
    },
    admission: {
      activeConnections: summary?.activeConnections,
      maxActiveConnections: summary?.maxActiveConnections,
      maxConnectionsPerIp: summary?.maxConnectionsPerIp,
      activeConnectionIps: summary?.activeConnectionIps,
      sessionPendingTickets: summary?.sessionPendingTickets,
      sessionTicketCapacity: summary?.sessionTicketCapacity,
    },
    networking: {
      tickBudgetUs: summary?.tickBudgetUs,
      snapshotIntervalMs: summary?.snapshotIntervalMs,
      interestRadiusUnits: summary?.interestRadiusUnits,
      maxSnapshotBytes: summary?.maxSnapshotBytes,
      maxAdminSnapshotBytes: summary?.maxAdminSnapshotBytes,
      websocketHeartbeatSeconds: summary?.websocketHeartbeatSeconds,
      websocketIdleTimeoutSeconds: summary?.websocketIdleTimeoutSeconds,
      websocketMaxTextBytes: summary?.websocketMaxTextBytes,
      websocketMessageBurst: summary?.websocketMessageBurst,
      websocketMessageRefillPerSecond: summary?.websocketMessageRefillPerSecond,
      clientRejectLimit: summary?.clientRejectLimit,
      httpBodyLimitBytes: summary?.httpBodyLimitBytes,
      adminEventLimitCap: summary?.adminEventLimitCap,
    },
    rateLimits: {
      sessionIssueRateLimitPerMinute: summary?.sessionIssueRateLimitPerMinute,
      sessionIssueRateLimitBurst: summary?.sessionIssueRateLimitBurst,
      sessionIssueRateLimitClients: summary?.sessionIssueRateLimitClients,
      sessionIssueRateLimitMaxClients: summary?.sessionIssueRateLimitMaxClients,
      accountSessionRateLimitPerMinute: summary?.accountSessionRateLimitPerMinute,
      accountSessionRateLimitBurst: summary?.accountSessionRateLimitBurst,
      accountSessionRateLimitSubjects: summary?.accountSessionRateLimitSubjects,
      accountSessionRateLimitMaxSubjects: summary?.accountSessionRateLimitMaxSubjects,
    },
  };
}

function summarizePosture(summary, metrics) {
  const originAllowlistEnabled =
    summary?.originAllowlistEnabled === true && Number(summary?.originAllowedCount ?? 0) > 0;
  const sessionTicketCapacityAvailable =
    Number.isFinite(summary?.sessionPendingTickets) &&
    Number.isFinite(summary?.sessionTicketCapacity) &&
    summary.sessionPendingTickets < summary.sessionTicketCapacity;
  const connectionCapacityAvailable =
    Number.isFinite(summary?.activeConnections) &&
    Number.isFinite(summary?.maxActiveConnections) &&
    summary.activeConnections < summary.maxActiveConnections;
  const durablePersistenceHealthy =
    metrics.sundermere_durable_journal_persist_failed_total === 0 &&
    metrics.sundermere_durable_settlement_persist_failed_total === 0;
  const settlementQueueHasCapacity = metrics.sundermere_settlement_queue_capacity > 0;

  return {
    publicDeployment: summary?.publicDeployment === true,
    deploymentProfile: summary?.deploymentProfile ?? null,
    requireSession: summary?.requireSession === true,
    requireAccount: summary?.requireAccount === true,
    originAllowlistEnabled,
    notDraining: summary?.draining === false,
    chainStubDisabled: summary?.chainEnabled === false,
    sessionTicketCapacityAvailable,
    connectionCapacityAvailable,
    durablePersistenceHealthy,
    settlementQueueHasCapacity,
  };
}

function summarizeMetrics(metrics) {
  const names = [
    "sundermere_public_deployment",
    "sundermere_deployment_profile_local",
    "sundermere_deployment_profile_shared_poc",
    "sundermere_deployment_profile_production",
    "sundermere_draining",
    "sundermere_require_session",
    "sundermere_require_account",
    "sundermere_chain_enabled",
    "sundermere_origin_allowlist_enabled",
    "sundermere_origin_allowed_origins",
    "sundermere_tick",
    "sundermere_players",
    "sundermere_active_connections",
    "sundermere_max_active_connections",
    "sundermere_ws_connections_total",
    "sundermere_ws_messages_rejected_total",
    "sundermere_ws_capacity_rejected_total",
    "sundermere_ws_peer_capacity_rejected_total",
    "sundermere_ws_snapshot_payload_rejected_total",
    "sundermere_admin_snapshot_payload_rejected_total",
    "sundermere_origin_rejected_total",
    "sundermere_account_auth_rejected_total",
    "sundermere_admin_auth_rejected_total",
    "sundermere_metrics_auth_rejected_total",
    "sundermere_session_ticket_rejected_total",
    "sundermere_session_ticket_capacity_rejected_total",
    "sundermere_session_issue_rate_limited_total",
    "sundermere_session_account_rate_limited_total",
    "sundermere_session_draining_rejected_total",
    "sundermere_session_pending_tickets",
    "sundermere_session_ticket_capacity",
    "sundermere_tick_duration_last_us",
    "sundermere_tick_duration_max_us",
    "sundermere_tick_overruns_total",
    "sundermere_journal_events",
    "sundermere_journal_last_sequence",
    "sundermere_journal_sequence_anomalies",
    "sundermere_settlement_pending_jobs",
    "sundermere_settlement_confirmed_jobs",
    "sundermere_settlement_owned_assets",
    "sundermere_settlement_outbox_events",
    "sundermere_settlement_queue_capacity",
    "sundermere_settlement_queue_full_total",
    "sundermere_settlement_queue_closed_total",
    "sundermere_durable_journal_persist_failed_total",
    "sundermere_durable_settlement_persist_failed_total",
  ];
  return Object.fromEntries(names.map((name) => [name, metrics[name] ?? null]));
}

function summarizeEvents(events) {
  const list = Array.isArray(events) ? events : [];
  const byType = {};
  let latestSequence = 0;
  let latestTick = 0;
  for (const event of list) {
    const type = event?.kind?.type ?? "unknown";
    byType[type] = (byType[type] ?? 0) + 1;
    latestSequence = Math.max(latestSequence, Number(event?.sequence ?? 0));
    latestTick = Math.max(latestTick, Number(event?.tick ?? 0));
  }
  return {
    requestedLimit: eventLimit,
    returned: list.length,
    latestSequence,
    latestTick,
    byType,
  };
}

function summarizeOwnership(receipts) {
  const list = Array.isArray(receipts) ? receipts : [];
  const byStatus = {};
  let chainTxPresent = 0;
  let accountSubjectPresent = 0;
  for (const receipt of list) {
    const status = receipt?.status ?? "unknown";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (receipt?.chainTx) chainTxPresent += 1;
    if (receipt?.accountSubject) accountSubjectPresent += 1;
  }
  return {
    count: list.length,
    byStatus,
    chainTxPresent,
    accountSubjectPresent,
  };
}

async function fetchJson(endpoint, options) {
  const response = await fetchWithTimeout(endpoint, options);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return { status: response.status, body };
}

async function fetchText(endpoint, options) {
  const response = await fetchWithTimeout(endpoint, options);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return { status: response.status, body };
}

async function fetchWithTimeout(pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(new URL(pathname, baseUrl), {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
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

function adminHeaders() {
  return tokenHeaders("x-admin-token", adminToken, "application/json");
}

function metricsHeaders(accept) {
  return tokenHeaders("x-metrics-token", metricsToken, accept);
}

function tokenHeaders(header, token, accept) {
  return token ? { [header]: token, accept } : { accept };
}

function redactedDurableBasename(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const basename = path.basename(value);
  if (basename.endsWith("settlement-outbox.jsonl")) return "settlement-outbox.jsonl";
  if (basename.endsWith("journal.jsonl")) return "journal.jsonl";
  return path.extname(basename) === ".jsonl" ? "redacted.jsonl" : "redacted";
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
