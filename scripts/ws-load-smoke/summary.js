import { round } from "./config.js";

export function summarize(workers, elapsedMs, config) {
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
    url: config.url,
    clients: config.clients,
    durationMs: config.durationMs,
    inputHz: config.inputHz,
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

export function benchmarkFailures(totals, config) {
  const failures = [];
  const thresholds = config.thresholds;
  if (totals.connected !== config.clients) {
    failures.push(`connected ${totals.connected}/${config.clients}`);
  }
  if (totals.welcomed !== config.clients) {
    failures.push(`welcomed ${totals.welcomed}/${config.clients}`);
  }
  if (totals.clientsWithSnapshots !== config.clients) {
    failures.push(`clientsWithSnapshots ${totals.clientsWithSnapshots}/${config.clients}`);
  }
  if (totals.errors > 0) {
    failures.push(`errors ${totals.errors}`);
  }
  if (totals.identityMismatches > 0) {
    failures.push(`identityMismatches ${totals.identityMismatches}`);
  }
  if (totals.snapshotsPerClientSecond < thresholds.minSnapshotsPerClientSecond) {
    failures.push(
      `snapshotsPerClientSecond ${totals.snapshotsPerClientSecond} < ${thresholds.minSnapshotsPerClientSecond}`,
    );
  }
  if (totals.averageMessageBytes > thresholds.maxAverageMessageBytes) {
    failures.push(
      `averageMessageBytes ${totals.averageMessageBytes} > ${thresholds.maxAverageMessageBytes}`,
    );
  }
  if (totals.joinLatencyMs.p95 > thresholds.maxJoinP95Ms) {
    failures.push(`joinLatencyMs.p95 ${totals.joinLatencyMs.p95} > ${thresholds.maxJoinP95Ms}`);
  }
  if (totals.serverMetrics?.error) {
    failures.push(`metrics ${totals.serverMetrics.error}`);
  }
  if (totals.serverMetrics && !totals.serverMetrics.skipped && !totals.serverMetrics.error) {
    if (totals.serverMetrics.delta.tickOverruns > thresholds.maxTickOverruns) {
      failures.push(
        `tickOverruns ${totals.serverMetrics.delta.tickOverruns} > ${thresholds.maxTickOverruns}`,
      );
    }
    if (totals.serverMetrics.delta.sendErrors > thresholds.maxSendErrors) {
      failures.push(`sendErrors ${totals.serverMetrics.delta.sendErrors} > ${thresholds.maxSendErrors}`);
    }
    if (totals.serverMetrics.delta.snapshotPayloadRejects > thresholds.maxSnapshotPayloadRejects) {
      failures.push(
        `snapshotPayloadRejects ${totals.serverMetrics.delta.snapshotPayloadRejects} > ${thresholds.maxSnapshotPayloadRejects}`,
      );
    }
  }
  return failures;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const index = Math.ceil(values.length * p) - 1;
  return values[Math.max(0, Math.min(values.length - 1, index))];
}

function sum(values, key) {
  return values.reduce((total, value) => total + value[key], 0);
}
