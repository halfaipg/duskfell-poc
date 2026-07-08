import { performance } from "node:perf_hooks";

import { parseLoadConfig } from "./ws-load-smoke/config.js";
import { runClient } from "./ws-load-smoke/client.js";
import { compareServerMetrics, fetchServerMetrics } from "./ws-load-smoke/metrics.js";
import { benchmarkFailures, summarize } from "./ws-load-smoke/summary.js";

const config = parseLoadConfig(process.argv.slice(2));

const metricsBefore = config.skipMetrics
  ? { skipped: true }
  : await fetchServerMetrics(config.metricsUrl, config.metricsToken).catch((err) => ({
      error: err.message,
    }));
const startedAt = performance.now();
const workers = await Promise.all(
  Array.from({ length: config.clients }, (_, index) =>
    runClient({
      index,
      url: config.url,
      durationMs: config.durationMs,
      inputHz: config.inputHz,
      connectTimeoutMs: config.connectTimeoutMs,
    }),
  ),
);
const elapsedMs = performance.now() - startedAt;
const metricsAfter = config.skipMetrics
  ? { skipped: true }
  : await fetchServerMetrics(config.metricsUrl, config.metricsToken).catch((err) => ({
      error: err.message,
    }));

const totals = summarize(workers, elapsedMs, config);
totals.serverMetrics = compareServerMetrics(metricsBefore, metricsAfter);
totals.thresholds = config.thresholds;
totals.failures = benchmarkFailures(totals, config);

console.log(JSON.stringify(totals, null, 2));

if (totals.failures.length > 0) {
  process.exitCode = 1;
}
