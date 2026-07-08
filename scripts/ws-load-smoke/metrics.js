export async function fetchServerMetrics(targetUrl, token) {
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

export function compareServerMetrics(before, after) {
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

function nonNegativeDelta(before, after) {
  return Math.max(0, after - before);
}
