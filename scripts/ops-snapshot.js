import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { summarizeAdminSummary } from "./ops-snapshot/admin-summary.js";
import { parseSnapshotConfig, round } from "./ops-snapshot/config.js";
import { adminHeaders, fetchJson, fetchText, metricsHeaders } from "./ops-snapshot/http.js";
import { parseMetrics, summarizeMetrics } from "./ops-snapshot/metrics.js";
import { summarizeEvents, summarizeOwnership, summarizePosture } from "./ops-snapshot/posture-summary.js";
import { summarizeReady, summarizeRuntime } from "./ops-snapshot/runtime-summary.js";

const context = parseSnapshotConfig(process.argv.slice(2));
const startedAt = performance.now();

const [health, ready, runtime, summary, metricsText, events, ownership] = await Promise.all([
  fetchText(context, "/healthz", {}),
  fetchJson(context, "/readyz", {}),
  fetchJson(context, "/admin/runtime", { headers: adminHeaders(context) }),
  fetchJson(context, "/admin/summary", { headers: adminHeaders(context) }),
  fetchText(context, "/metrics", { headers: metricsHeaders(context, "text/plain") }),
  context.eventLimit === 0
    ? Promise.resolve([])
    : fetchJson(context, `/admin/events?limit=${context.eventLimit}`, { headers: adminHeaders(context) }),
  fetchJson(context, "/admin/ownership", { headers: adminHeaders(context) }),
]);

const metrics = parseMetrics(metricsText.body);
const snapshot = {
  schemaVersion: "duskfell-ops-snapshot-v1",
  capturedAt: new Date().toISOString(),
  url: context.baseUrl.origin,
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
  events: summarizeEvents(events.body ?? events, context.eventLimit),
  ownership: summarizeOwnership(ownership.body),
};

const output = `${JSON.stringify(snapshot, null, 2)}\n`;
if (context.outPath) {
  await writeFile(context.outPath, output, { mode: 0o600 });
}
process.stdout.write(output);
