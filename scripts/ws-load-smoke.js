import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const url = args.url ?? "ws://127.0.0.1:4107/ws";
const clients = Number(args.clients ?? 20);
const durationMs = Number(args.durationMs ?? args.duration ?? 5000);
const inputHz = Number(args.inputHz ?? 10);
const connectTimeoutMs = Number(args.connectTimeoutMs ?? 4000);
const skipMetrics = args.skipMetrics === "true";
const metricsUrl = args.metricsUrl ?? defaultMetricsUrl(url);
const metricsToken = args.metricsToken;
const minSnapshotsPerClientSecond = readFiniteNumber(
  args.minSnapshotsPerClientSecond,
  5,
  "--minSnapshotsPerClientSecond",
);
const maxAverageMessageBytes = readFiniteNumber(
  args.maxAverageMessageBytes,
  65536,
  "--maxAverageMessageBytes",
);
const maxJoinP95Ms = readFiniteNumber(args.maxJoinP95Ms, connectTimeoutMs, "--maxJoinP95Ms");
const maxTickOverruns = readFiniteNumber(args.maxTickOverruns, 0, "--maxTickOverruns");
const maxSendErrors = readFiniteNumber(args.maxSendErrors, 0, "--maxSendErrors");
const maxSnapshotPayloadRejects = readFiniteNumber(
  args.maxSnapshotPayloadRejects,
  0,
  "--maxSnapshotPayloadRejects",
);

if (!Number.isInteger(clients) || clients <= 0) {
  throw new Error("--clients must be a positive integer");
}
if (!Number.isFinite(durationMs) || durationMs <= 0) {
  throw new Error("--durationMs must be positive");
}
if (!Number.isFinite(inputHz) || inputHz <= 0) {
  throw new Error("--inputHz must be positive");
}

const metricsBefore = skipMetrics
  ? { skipped: true }
  : await fetchServerMetrics(metricsUrl, metricsToken).catch((err) => ({ error: err.message }));
const startedAt = performance.now();
const workers = await Promise.all(
  Array.from({ length: clients }, (_, index) =>
    runClient({
      index,
      url,
      durationMs,
      inputHz,
      connectTimeoutMs,
    }),
  ),
);
const elapsedMs = performance.now() - startedAt;
const metricsAfter = skipMetrics
  ? { skipped: true }
  : await fetchServerMetrics(metricsUrl, metricsToken).catch((err) => ({ error: err.message }));
const totals = summarize(workers, elapsedMs);
totals.serverMetrics = compareServerMetrics(metricsBefore, metricsAfter);
totals.thresholds = {
  minSnapshotsPerClientSecond,
  maxAverageMessageBytes,
  maxJoinP95Ms,
  maxTickOverruns,
  maxSendErrors,
  maxSnapshotPayloadRejects,
};
totals.failures = benchmarkFailures(totals);

console.log(JSON.stringify(totals, null, 2));

if (totals.failures.length > 0) {
  process.exitCode = 1;
}

async function runClient({ index, url, durationMs, inputHz, connectTimeoutMs }) {
  const stats = {
    index,
    sessionIssued: false,
    sessionId: null,
    connected: false,
    welcome: false,
    playerId: null,
    identityMatched: false,
    snapshots: 0,
    bytes: 0,
    snapshotBytes: 0,
    errors: 0,
    closeCode: null,
    joinLatencyMs: null,
    firstTick: null,
    lastTick: null,
  };
  const startedAt = performance.now();
  let seq = 0;
  let inputTimer;
  let stopTimer;
  let connectTimer;

  const sessionUrl = new URL(url);
  const session = await issueSession(sessionUrl).catch(() => null);
  if (session?.sessionToken) {
    stats.sessionIssued = true;
    stats.sessionId = session.sessionId;
    sessionUrl.searchParams.set("session", session.sessionToken);
  }

  const ws = new WebSocket(sessionUrl);

  await new Promise((resolve) => {
    connectTimer = setTimeout(() => {
      stats.errors += 1;
      try {
        ws.close();
      } catch {
        // Closing a failed socket is best effort.
      }
      resolve();
    }, connectTimeoutMs);

    ws.addEventListener("open", () => {
      stats.connected = true;
      clearTimeout(connectTimer);
      inputTimer = setInterval(() => {
        seq += 1;
        const phase = (seq + index) % 40;
        sendJson(ws, {
          type: "input",
          seq,
          up: phase >= 10 && phase < 20,
          down: phase >= 30,
          left: phase >= 20 && phase < 30,
          right: phase < 10,
          interact: false,
        });
      }, 1000 / inputHz);
      stopTimer = setTimeout(() => ws.close(1000, "benchmark-complete"), durationMs);
    });

    ws.addEventListener("message", (event) => {
      const text = String(event.data);
      stats.bytes += Buffer.byteLength(text);
      try {
        const message = JSON.parse(text);
        if (message.type === "welcome") {
          stats.welcome = true;
          stats.playerId = message.playerId;
          stats.identityMatched = !stats.sessionId || stats.playerId === stats.sessionId;
          stats.joinLatencyMs = performance.now() - startedAt;
          stats.firstTick = message.snapshot?.tick ?? null;
        } else if (message.type === "snapshot") {
          stats.snapshots += 1;
          stats.snapshotBytes += Buffer.byteLength(text);
          stats.lastTick = message.tick ?? stats.lastTick;
        }
      } catch {
        stats.errors += 1;
      }
    });

    ws.addEventListener("error", () => {
      stats.errors += 1;
    });

    ws.addEventListener("close", (event) => {
      clearTimeout(connectTimer);
      clearInterval(inputTimer);
      clearTimeout(stopTimer);
      stats.closeCode = event.code;
      resolve();
    });
  });

  return stats;
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function summarize(workers, elapsedMs) {
  const connected = workers.filter((worker) => worker.connected).length;
  const welcomed = workers.filter((worker) => worker.welcome).length;
  const identityMismatches = workers.filter(
    (worker) => worker.sessionIssued && !worker.identityMatched,
  ).length;
  const snapshots = sum(workers, "snapshots");
  const bytes = sum(workers, "bytes");
  const snapshotBytes = sum(workers, "snapshotBytes");
  const errors = sum(workers, "errors");
  const latencies = workers
    .map((worker) => worker.joinLatencyMs)
    .filter((latency) => Number.isFinite(latency))
    .sort((a, b) => a - b);

  return {
    url,
    clients,
    durationMs,
    inputHz,
    elapsedMs: round(elapsedMs),
    connected,
    sessionsIssued: workers.filter((worker) => worker.sessionIssued).length,
    identityMismatches,
    welcomed,
    snapshots,
    snapshotRatePerSecond: round((snapshots / elapsedMs) * 1000),
    snapshotsPerClientSecond: connected > 0 ? round((snapshots / elapsedMs) * 1000 / connected) : 0,
    totalBytes: bytes,
    totalSnapshotBytes: snapshotBytes,
    averageMessageBytes: snapshots + welcomed > 0 ? round(bytes / (snapshots + welcomed)) : 0,
    averageSnapshotBytes: snapshots > 0 ? round(snapshotBytes / snapshots) : 0,
    errors,
    joinLatencyMs: {
      min: round(latencies[0] ?? 0),
      p50: round(percentile(latencies, 0.5)),
      p95: round(percentile(latencies, 0.95)),
      max: round(latencies.at(-1) ?? 0),
    },
    clientsWithSnapshots: workers.filter((worker) => worker.snapshots > 0).length,
  };
}

function benchmarkFailures(totals) {
  const failures = [];
  if (totals.connected !== clients) {
    failures.push(`connected ${totals.connected}/${clients}`);
  }
  if (totals.welcomed !== clients) {
    failures.push(`welcomed ${totals.welcomed}/${clients}`);
  }
  if (totals.clientsWithSnapshots !== clients) {
    failures.push(`clientsWithSnapshots ${totals.clientsWithSnapshots}/${clients}`);
  }
  if (totals.errors > 0) {
    failures.push(`errors ${totals.errors}`);
  }
  if (totals.identityMismatches > 0) {
    failures.push(`identityMismatches ${totals.identityMismatches}`);
  }
  if (totals.snapshotsPerClientSecond < minSnapshotsPerClientSecond) {
    failures.push(
      `snapshotsPerClientSecond ${totals.snapshotsPerClientSecond} < ${minSnapshotsPerClientSecond}`,
    );
  }
  if (totals.averageMessageBytes > maxAverageMessageBytes) {
    failures.push(`averageMessageBytes ${totals.averageMessageBytes} > ${maxAverageMessageBytes}`);
  }
  if (totals.joinLatencyMs.p95 > maxJoinP95Ms) {
    failures.push(`joinLatencyMs.p95 ${totals.joinLatencyMs.p95} > ${maxJoinP95Ms}`);
  }
  if (totals.serverMetrics?.error) {
    failures.push(`metrics ${totals.serverMetrics.error}`);
  }
  if (totals.serverMetrics && !totals.serverMetrics.skipped && !totals.serverMetrics.error) {
    if (totals.serverMetrics.delta.tickOverruns > maxTickOverruns) {
      failures.push(`tickOverruns ${totals.serverMetrics.delta.tickOverruns} > ${maxTickOverruns}`);
    }
    if (totals.serverMetrics.delta.sendErrors > maxSendErrors) {
      failures.push(`sendErrors ${totals.serverMetrics.delta.sendErrors} > ${maxSendErrors}`);
    }
    if (totals.serverMetrics.delta.snapshotPayloadRejects > maxSnapshotPayloadRejects) {
      failures.push(
        `snapshotPayloadRejects ${totals.serverMetrics.delta.snapshotPayloadRejects} > ${maxSnapshotPayloadRejects}`,
      );
    }
  }
  return failures;
}

function compareServerMetrics(before, after) {
  if (before?.skipped || after?.skipped) return { skipped: true };
  if (before?.error) return { error: `before ${before.error}` };
  if (after?.error) return { error: `after ${after.error}` };
  return {
    url: after.url,
    before,
    after,
    delta: {
      tickOverruns: nonNegativeDelta(before.tickOverruns, after.tickOverruns),
      sendErrors: nonNegativeDelta(before.sendErrors, after.sendErrors),
      snapshotPayloadRejects: nonNegativeDelta(
        before.snapshotPayloadRejects,
        after.snapshotPayloadRejects,
      ),
      snapshotsSentTotal: nonNegativeDelta(before.snapshotsSentTotal, after.snapshotsSentTotal),
      bytesOutTotal: nonNegativeDelta(before.bytesOutTotal, after.bytesOutTotal),
    },
  };
}

async function fetchServerMetrics(targetUrl, token) {
  const headers = token ? { "x-metrics-token": token } : {};
  const response = await fetch(targetUrl, { headers });
  if (!response.ok) {
    throw new Error(`${targetUrl} returned ${response.status}`);
  }
  const metrics = parseMetrics(await response.text(), [
    "sundermere_tick_overruns_total",
    "sundermere_ws_send_errors_total",
    "sundermere_ws_snapshot_payload_rejected_total",
    "sundermere_active_connections",
    "sundermere_ws_snapshots_sent_total",
    "sundermere_ws_bytes_out_total",
  ]);
  return {
    url: targetUrl,
    tickOverruns: metrics.sundermere_tick_overruns_total,
    sendErrors: metrics.sundermere_ws_send_errors_total,
    snapshotPayloadRejects: metrics.sundermere_ws_snapshot_payload_rejected_total,
    activeConnections: metrics.sundermere_active_connections,
    snapshotsSentTotal: metrics.sundermere_ws_snapshots_sent_total,
    bytesOutTotal: metrics.sundermere_ws_bytes_out_total,
  };
}

async function issueSession(wsUrl) {
  const sessionUrl = new URL("/api/session", wsUrl);
  sessionUrl.protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
  const response = await fetch(sessionUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) return null;
  return response.json();
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue != null) {
      parsed[key] = inlineValue;
      continue;
    }
    if (rawArgs[index + 1] == null || rawArgs[index + 1].startsWith("--")) {
      parsed[key] = "true";
      continue;
    }
    parsed[key] = rawArgs[index + 1];
    index += 1;
  }
  return parsed;
}

function defaultMetricsUrl(wsUrl) {
  const target = new URL("/metrics", wsUrl);
  target.protocol = wsUrl.startsWith("wss:") ? "https:" : "http:";
  return target.href;
}

function parseMetrics(text, names) {
  const parsed = {};
  for (const name of names) {
    const match = text.match(new RegExp(`^${name}\\s+(-?\\d+(?:\\.\\d+)?)$`, "m"));
    if (!match) {
      throw new Error(`missing metric ${name}`);
    }
    parsed[name] = Number(match[1]);
  }
  return parsed;
}

function readFiniteNumber(value, fallback, name) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return parsed;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const index = Math.ceil(values.length * p) - 1;
  return values[Math.max(0, Math.min(values.length - 1, index))];
}

function sum(values, key) {
  return values.reduce((total, value) => total + value[key], 0);
}

function nonNegativeDelta(before, after) {
  return Math.max(0, after - before);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
