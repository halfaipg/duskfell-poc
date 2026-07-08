import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { createAdmissionPreflightContext, round } from "./ws-admission-preflight-smoke/config.js";
import { fetchText, parseMetrics, waitForMetric } from "./ws-admission-preflight-smoke/http.js";
import { startServer, stopServer } from "./ws-admission-preflight-smoke/server.js";
import {
  closeHeldSocket,
  connectAndHold,
  issueSession,
  rawWebSocketHandshake,
} from "./ws-admission-preflight-smoke/websocket.js";

const context = createAdmissionPreflightContext();
await mkdir(context.runtimeDir, { recursive: true });

const startedAt = performance.now();
let server = null;
let firstSocket = null;
let secondSocket = null;
let error = null;
let result = null;

try {
  server = await startServer(context);

  const firstSession = await issueSession(context);
  firstSocket = await connectAndHold(context, firstSession.sessionToken);

  const missingWhileFull = await rawWebSocketHandshake(context);
  const invalidWhileFull = await rawWebSocketHandshake(context, "not-a-ticket");
  const secondSession = await issueSession(context);
  const validWhileFull = await rawWebSocketHandshake(context, secondSession.sessionToken);
  const duringFullMetrics = parseMetrics(await fetchText(context, "/metrics"), [
    "sundermere_active_connections",
    "sundermere_session_pending_tickets",
    "sundermere_session_ticket_rejected_total",
    "sundermere_ws_capacity_rejected_total",
  ]);

  closeHeldSocket(firstSocket, "ws-admission-preflight-smoke-release-capacity");
  await waitForMetric(context, "sundermere_active_connections", 0);

  secondSocket = await connectAndHold(context, secondSession.sessionToken);
  closeHeldSocket(secondSocket, "ws-admission-preflight-smoke-complete");
  await waitForMetric(context, "sundermere_active_connections", 0);

  const afterMetrics = parseMetrics(await fetchText(context, "/metrics"), [
    "sundermere_active_connections",
    "sundermere_session_pending_tickets",
    "sundermere_session_ticket_rejected_total",
    "sundermere_ws_capacity_rejected_total",
  ]);

  result = {
    port: context.port,
    firstIdentityMatched: firstSocket.playerId === firstSession.sessionId,
    secondIdentityMatched: secondSocket.playerId === secondSession.sessionId,
    statusLines: {
      missingWhileFull: missingWhileFull.statusLine,
      invalidWhileFull: invalidWhileFull.statusLine,
      validWhileFull: validWhileFull.statusLine,
    },
    duringFullMetrics,
    afterMetrics,
    elapsedMs: round(performance.now() - startedAt),
  };
} catch (err) {
  error = err;
} finally {
  closeHeldSocket(firstSocket, "ws-admission-preflight-smoke-cleanup");
  closeHeldSocket(secondSocket, "ws-admission-preflight-smoke-cleanup");
  if (server) {
    await stopServer(server);
  }
}

const ok =
  !error &&
  result?.firstIdentityMatched === true &&
  result?.secondIdentityMatched === true &&
  result?.statusLines.missingWhileFull?.startsWith("HTTP/1.1 401") &&
  result?.statusLines.invalidWhileFull?.startsWith("HTTP/1.1 401") &&
  result?.statusLines.validWhileFull?.startsWith("HTTP/1.1 503") &&
  result?.duringFullMetrics.sundermere_active_connections === 1 &&
  result?.duringFullMetrics.sundermere_session_pending_tickets === 1 &&
  result?.duringFullMetrics.sundermere_session_ticket_rejected_total === 2 &&
  result?.duringFullMetrics.sundermere_ws_capacity_rejected_total === 1 &&
  result?.afterMetrics.sundermere_active_connections === 0 &&
  result?.afterMetrics.sundermere_session_pending_tickets === 0 &&
  result?.afterMetrics.sundermere_session_ticket_rejected_total === 2 &&
  result?.afterMetrics.sundermere_ws_capacity_rejected_total === 1;

console.log(
  JSON.stringify(
    {
      ok,
      error: error?.message ?? null,
      ...result,
    },
    null,
    2,
  ),
);

if (!ok) {
  process.exitCode = 1;
}
