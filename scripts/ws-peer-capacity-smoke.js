import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { createPeerCapacityContext, round } from "./ws-peer-capacity-smoke/config.js";
import { fetchJson, fetchText, parseMetrics } from "./ws-peer-capacity-smoke/http.js";
import { startServer, stopServer } from "./ws-peer-capacity-smoke/server.js";
import { connectAndHold, connectAndObserve } from "./ws-peer-capacity-smoke/websocket.js";

const context = createPeerCapacityContext(process.argv.slice(2));

await mkdir(context.runtimeDir, { recursive: true });

let server = null;
let first = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer(context);
  first = await connectAndHold(context);
  const second = await connectAndObserve(context, 1200);
  const [summary, metricsText] = await Promise.all([
    fetchJson(context, "/admin/summary"),
    fetchText(context, "/metrics"),
  ]);
  const metrics = parseMetrics(metricsText, [
    "sundermere_active_connections",
    "sundermere_max_connections_per_ip",
    "sundermere_active_connection_ips",
    "sundermere_ws_peer_capacity_rejected_total",
    "sundermere_session_pending_tickets",
    "sundermere_session_ticket_rejected_total",
  ]);

  result = {
    port: context.port,
    first: {
      welcomed: first.welcomed,
      playerId: first.playerId,
      identityMatched: first.identityMatched,
    },
    second,
    summary: {
      activeConnections: summary.activeConnections,
      maxConnectionsPerIp: summary.maxConnectionsPerIp,
      activeConnectionIps: summary.activeConnectionIps,
      sessionPendingTickets: summary.sessionPendingTickets,
    },
    metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      first.welcomed &&
      first.identityMatched &&
      second.statusLine.startsWith("HTTP/1.1 503") &&
      second.rejectedBeforeUpgrade &&
      summary.activeConnections === 1 &&
      summary.maxConnectionsPerIp === context.maxConnectionsPerIp &&
      summary.activeConnectionIps === 1 &&
      summary.sessionPendingTickets === 1 &&
      metrics.sundermere_active_connections === 1 &&
      metrics.sundermere_max_connections_per_ip === context.maxConnectionsPerIp &&
      metrics.sundermere_active_connection_ips === 1 &&
      metrics.sundermere_ws_peer_capacity_rejected_total === 1 &&
      metrics.sundermere_session_pending_tickets === 1 &&
      metrics.sundermere_session_ticket_rejected_total === 0,
  };
} finally {
  if (first) {
    first.close();
  }
  if (server) {
    await stopServer(server);
  }
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) {
  process.exitCode = 1;
}
