import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { createAccountCapacityContext, round, signJwt } from "./ws-account-capacity-smoke/config.js";
import { fetchJson, fetchText, parseMetrics } from "./ws-account-capacity-smoke/http.js";
import { startServer, stopServer } from "./ws-account-capacity-smoke/server.js";
import {
  connectAndHoldAccountSocket,
  connectAndObserveAccountCapacityRejection,
} from "./ws-account-capacity-smoke/websocket.js";

const context = createAccountCapacityContext(process.argv.slice(2));

await mkdir(context.runtimeDir, { recursive: true });

let server = null;
let first = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer(context);
  const jwt = signJwt(context, {
    sub: context.subject,
    iss: context.issuer,
    aud: context.audience,
    exp: Math.floor(Date.now() / 1000) + 120,
  });
  first = await connectAndHoldAccountSocket(context, jwt);
  const second = await connectAndObserveAccountCapacityRejection(context, jwt, 1200);
  const [summary, metricsText] = await Promise.all([
    fetchJson(context, "/admin/summary"),
    fetchText(context, "/metrics"),
  ]);
  const metrics = parseMetrics(metricsText, [
    "sundermere_active_connections",
    "sundermere_max_connections_per_account",
    "sundermere_active_connection_accounts",
    "sundermere_ws_account_capacity_rejected_total",
    "sundermere_session_pending_tickets",
    "sundermere_session_ticket_rejected_total",
  ]);

  result = {
    port: context.port,
    first: {
      welcomed: first.welcomed,
      playerId: first.playerId,
      identityMatched: first.identityMatched,
      accountSubject: first.accountSubject,
    },
    second,
    summary: {
      activeConnections: summary.activeConnections,
      maxConnectionsPerAccount: summary.maxConnectionsPerAccount,
      activeConnectionAccounts: summary.activeConnectionAccounts,
      sessionPendingTickets: summary.sessionPendingTickets,
    },
    metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      first.welcomed &&
      first.identityMatched &&
      first.accountSubject === context.subject &&
      second.statusLine.startsWith("HTTP/1.1 503") &&
      second.body.includes("server account connection capacity reached") &&
      second.rejectedBeforeUpgrade &&
      summary.activeConnections === 1 &&
      summary.maxConnectionsPerAccount === context.maxConnectionsPerAccount &&
      summary.activeConnectionAccounts === 1 &&
      summary.sessionPendingTickets === 1 &&
      metrics.sundermere_active_connections === 1 &&
      metrics.sundermere_max_connections_per_account === context.maxConnectionsPerAccount &&
      metrics.sundermere_active_connection_accounts === 1 &&
      metrics.sundermere_ws_account_capacity_rejected_total === 1 &&
      metrics.sundermere_session_pending_tickets === 1 &&
      metrics.sundermere_session_ticket_rejected_total === 0,
  };
} catch (err) {
  result = {
    port: context.port,
    elapsedMs: round(performance.now() - startedAt),
    ok: false,
    error: err.message,
    serverExitCode: server?.exitCode ?? null,
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
