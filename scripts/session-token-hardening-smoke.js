import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { createSessionTokenHardeningContext, round } from "./session-token-hardening-smoke/config.js";
import { fetchJson, fetchText, issueSession, parseMetrics } from "./session-token-hardening-smoke/http.js";
import { startServer, stopServer } from "./session-token-hardening-smoke/server.js";
import {
  connectWithTicket,
  requestWebSocketUpgrade,
} from "./session-token-hardening-smoke/websocket.js";

const context = createSessionTokenHardeningContext(process.argv.slice(2));

await mkdir(context.runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer(context);
  const session = await issueSession(context);
  const oversizedToken = "x".repeat(129);
  const oversizedUpgrade = await requestWebSocketUpgrade(context, oversizedToken);
  const afterRejectSummary = await fetchJson(context, "/admin/summary");
  const accepted = await connectWithTicket(
    context,
    session.body.sessionToken,
    session.body.sessionId,
  );
  const afterAcceptSummary = await fetchJson(context, "/admin/summary");
  const metrics = parseMetrics(await fetchText(context, "/metrics"), [
    "sundermere_players",
    "sundermere_ws_connections_total",
    "sundermere_session_pending_tickets",
    "sundermere_session_tickets_issued_total",
    "sundermere_session_ticket_rejected_total",
  ]);

  result = {
    port: context.port,
    sessionStatus: session.status,
    oversizedUpgrade: {
      statusCode: oversizedUpgrade.statusCode,
      statusLine: oversizedUpgrade.statusLine,
      body: oversizedUpgrade.body.trim(),
    },
    afterReject: {
      players: afterRejectSummary.players,
      sessionPendingTickets: afterRejectSummary.sessionPendingTickets,
    },
    accepted,
    afterAccept: {
      players: afterAcceptSummary.players,
      sessionPendingTickets: afterAcceptSummary.sessionPendingTickets,
    },
    metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      session.status === 200 &&
      oversizedUpgrade.statusCode === 401 &&
      oversizedUpgrade.body.includes("invalid session ticket") &&
      afterRejectSummary.players === 0 &&
      afterRejectSummary.sessionPendingTickets === 1 &&
      accepted.welcomeReceived &&
      accepted.identityMatched &&
      afterAcceptSummary.players === 0 &&
      afterAcceptSummary.sessionPendingTickets === 0 &&
      metrics.sundermere_players === 0 &&
      metrics.sundermere_ws_connections_total === 1 &&
      metrics.sundermere_session_pending_tickets === 0 &&
      metrics.sundermere_session_tickets_issued_total === 1 &&
      metrics.sundermere_session_ticket_rejected_total === 1,
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
  if (server) {
    await stopServer(server);
  }
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) {
  process.exitCode = 1;
}
