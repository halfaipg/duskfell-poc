import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { parseSmokeConfig, round } from "./metrics-smoke/config.js";
import { expectedAfterSessionValues, expectedInitialValues, parseMetrics, requiredMetrics } from "./metrics-smoke/contract.js";
import { fetchText, issueSession } from "./metrics-smoke/http.js";
import { startServer, stopServer } from "./metrics-smoke/server.js";

const context = parseSmokeConfig(process.argv.slice(2));

await mkdir(context.runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer(context);
  const initialMetricsText = await fetchText(context, "/metrics");
  const initialMetrics = parseMetrics(initialMetricsText, requiredMetrics);
  const session = await issueSession(context);
  const afterSessionText = await fetchText(context, "/metrics");
  const afterSessionMetrics = parseMetrics(afterSessionText, requiredMetrics);

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
    port: context.port,
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
