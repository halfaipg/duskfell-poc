import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { createIngressConfigContext, round } from "./ws-ingress-config-smoke/config.js";
import {
  fetchJson,
  fetchText,
  parseMetrics,
  waitForRejectedMessages,
} from "./ws-ingress-config-smoke/http.js";
import { startServer, stopServer } from "./ws-ingress-config-smoke/server.js";
import { sendBurstUntilClose, sendOversizedFrame } from "./ws-ingress-config-smoke/websocket.js";

const context = createIngressConfigContext(process.argv.slice(2));

await mkdir(context.runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer(context);
  const oversized = await sendOversizedFrame(context);
  const rateLimited = await sendBurstUntilClose(context);
  await waitForRejectedMessages(context, context.clientRejectLimit + 1);

  const [summary, metricsText, events] = await Promise.all([
    fetchJson(context, "/admin/summary"),
    fetchText(context, "/metrics"),
    fetchJson(context, "/admin/events?limit=20"),
  ]);
  const metrics = parseMetrics(metricsText, [
    "sundermere_ws_messages_rejected_total",
    "sundermere_ws_messages_rejected_message_too_large_total",
    "sundermere_ws_messages_rejected_rate_limited_total",
    "sundermere_ws_messages_in_total",
    "sundermere_ws_max_text_bytes",
    "sundermere_ws_message_burst",
    "sundermere_ws_message_refill_per_second",
    "sundermere_ws_max_input_sequence_step",
    "sundermere_client_reject_limit",
  ]);
  const oversizedEvent = events.find((event) =>
    event.kind?.reason?.startsWith(
      `message-too-large bytes=${oversized.bytes} max=${context.wsMaxTextBytes}`,
    ),
  );
  const rateLimitedEvents = events.filter(
    (event) => event.kind?.type === "clientMessageRejected" && event.kind.reason === "rate-limited",
  );

  result = {
    port: context.port,
    oversized,
    rateLimited,
    summary: {
      websocketMaxTextBytes: summary.websocketMaxTextBytes,
      websocketMessageBurst: summary.websocketMessageBurst,
      websocketMessageRefillPerSecond: summary.websocketMessageRefillPerSecond,
      websocketMaxInputSequenceStep: summary.websocketMaxInputSequenceStep,
      clientRejectLimit: summary.clientRejectLimit,
    },
    metrics,
    oversizedJournaled: Boolean(oversizedEvent),
    rateLimitedJournalEvents: rateLimitedEvents.length,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      oversized.identityMatched &&
      rateLimited.identityMatched &&
      rateLimited.closed &&
      summary.websocketMaxTextBytes === context.wsMaxTextBytes &&
      summary.websocketMessageBurst === context.wsMessageBurst &&
      summary.websocketMessageRefillPerSecond === context.wsMessageRefillPerSecond &&
      summary.websocketMaxInputSequenceStep === context.wsMaxInputSequenceStep &&
      summary.clientRejectLimit === context.clientRejectLimit &&
      metrics.sundermere_ws_max_text_bytes === context.wsMaxTextBytes &&
      metrics.sundermere_ws_message_burst === context.wsMessageBurst &&
      metrics.sundermere_ws_message_refill_per_second === context.wsMessageRefillPerSecond &&
      metrics.sundermere_ws_max_input_sequence_step === context.wsMaxInputSequenceStep &&
      metrics.sundermere_client_reject_limit === context.clientRejectLimit &&
      metrics.sundermere_ws_messages_rejected_total >= context.clientRejectLimit + 1 &&
      metrics.sundermere_ws_messages_rejected_message_too_large_total === 1 &&
      metrics.sundermere_ws_messages_rejected_rate_limited_total >= context.clientRejectLimit &&
      metrics.sundermere_ws_messages_in_total >= context.wsMessageBurst &&
      Boolean(oversizedEvent) &&
      rateLimitedEvents.length >= context.clientRejectLimit,
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
