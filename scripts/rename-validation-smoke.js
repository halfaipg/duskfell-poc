import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { createRenameValidationContext, round } from "./rename-validation-smoke/config.js";
import { fetchJson, fetchText, issueSession, parseMetrics } from "./rename-validation-smoke/http.js";
import { startServer, stopServer } from "./rename-validation-smoke/server.js";
import { runRenameFlow } from "./rename-validation-smoke/websocket.js";

const context = createRenameValidationContext(process.argv.slice(2));

await mkdir(context.runtimeDir, { recursive: true });

let server = null;
let renameFlow = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer(context);
  const rejectedSession = await issueSession(context, { name: context.invalidName });
  const unknownFieldSession = await issueSession(context, { name: "Scout_Extra", admin: true });
  const session = await issueSession(context, { name: `  ${context.spawnName}  ` });
  const duplicatePendingSession = await issueSession(context, {
    name: context.spawnName.toLowerCase(),
  });
  renameFlow = await runRenameFlow(context, session.body.sessionToken, session.body.sessionId);
  const duplicateActiveSession = await issueSession(context, { name: context.validName });
  const metrics = parseMetrics(await fetchText(context, "/metrics"), [
    "sundermere_ws_messages_rejected_total",
    "sundermere_ws_messages_in_total",
    "sundermere_session_request_invalid_total",
    "sundermere_session_display_name_invalid_total",
    "sundermere_session_display_name_conflict_total",
  ]);
  const events = await fetchJson(context, "/admin/events?limit=20");
  const invalidRenameEvent = events.find(
    (event) =>
      event.kind?.type === "clientMessageRejected" &&
      event.kind.reason === "invalid-player-name invalid-characters",
  );

  result = {
    port: context.port,
    rejectedSession: {
      status: rejectedSession.status,
      body: rejectedSession.body,
    },
    unknownFieldSession: {
      status: unknownFieldSession.status,
      body: unknownFieldSession.body,
    },
    acceptedSession: {
      status: session.status,
      displayName: session.body.displayName,
    },
    duplicatePendingSession: {
      status: duplicatePendingSession.status,
      body: duplicatePendingSession.body,
    },
    duplicateActiveSession: {
      status: duplicateActiveSession.status,
      body: duplicateActiveSession.body,
    },
    ...renameFlow,
    metrics,
    invalidRenameJournaled: Boolean(invalidRenameEvent),
    elapsedMs: round(performance.now() - startedAt),
    ok:
      rejectedSession.status === 400 &&
      rejectedSession.body.includes("invalid-player-name") &&
      unknownFieldSession.status === 400 &&
      unknownFieldSession.body.includes("invalid session request JSON") &&
      session.status === 200 &&
      session.body.displayName === context.spawnName &&
      duplicatePendingSession.status === 409 &&
      duplicatePendingSession.body.includes("already-reserved") &&
      duplicateActiveSession.status === 409 &&
      duplicateActiveSession.body.includes("already-active") &&
      renameFlow.identityMatched &&
      renameFlow.spawnNameObserved &&
      renameFlow.validRenameObserved &&
      renameFlow.invalidRenamePreservedName &&
      metrics.sundermere_ws_messages_in_total === 2 &&
      metrics.sundermere_ws_messages_rejected_total >= 1 &&
      metrics.sundermere_session_request_invalid_total === 1 &&
      metrics.sundermere_session_display_name_invalid_total === 1 &&
      metrics.sundermere_session_display_name_conflict_total === 2 &&
      Boolean(invalidRenameEvent),
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
  renameFlow?.close?.();
  if (server) {
    await stopServer(server);
  }
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) {
  process.exitCode = 1;
}
