import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { createOriginAllowlistContext, round } from "./origin-allowlist-smoke/config.js";
import { fetchJson, fetchText, issueSession, parseMetrics } from "./origin-allowlist-smoke/http.js";
import { expectStartupFailure, startServer, stopServer } from "./origin-allowlist-smoke/server.js";
import { rawWebSocketHandshake } from "./origin-allowlist-smoke/websocket.js";

const context = createOriginAllowlistContext(process.argv.slice(2));

await mkdir(context.runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  const pathOriginStartup = await expectStartupFailure(
    context,
    "path-origin",
    "https://allowed.example/path",
    "without path, query, or fragment",
  );
  const tooManyOriginsStartup = await expectStartupFailure(
    context,
    "too-many-origins",
    Array.from({ length: 17 }, (_, index) => `https://allowed-${index}.example`).join(","),
    "at most 16 origins",
  );
  const oversizedOriginStartup = await expectStartupFailure(
    context,
    "oversized-origin",
    `https://${"a".repeat(512)}`,
    "at most 512 bytes",
  );

  server = await startServer(context);

  const health = await fetchText(context, "/healthz");
  const missingSession = await issueSession(context);
  const wrongSession = await issueSession(context, context.wrongOrigin);
  const allowedSession = await issueSession(context, context.allowedOrigin);

  const missingWs = await rawWebSocketHandshake(context, allowedSession.body.sessionToken);
  const wrongWs = await rawWebSocketHandshake(
    context,
    allowedSession.body.sessionToken,
    context.wrongOrigin,
  );
  const allowedWs = await rawWebSocketHandshake(
    context,
    allowedSession.body.sessionToken,
    context.allowedOrigin,
  );

  const summary = await fetchJson(context, "/admin/summary");
  const metrics = parseMetrics(await fetchText(context, "/metrics"), [
    "sundermere_origin_allowlist_enabled",
    "sundermere_origin_allowed_origins",
    "sundermere_origin_rejected_total",
  ]);

  result = {
    port: context.port,
    pathOriginStartup,
    tooManyOriginsStartup,
    oversizedOriginStartup,
    health,
    sessionStatuses: {
      missing: missingSession.status,
      wrong: wrongSession.status,
      allowed: allowedSession.status,
    },
    websocketStatusLines: {
      missing: missingWs.statusLine,
      wrong: wrongWs.statusLine,
      allowed: allowedWs.statusLine,
    },
    summary: {
      originAllowlistEnabled: summary.originAllowlistEnabled,
      originAllowedCount: summary.originAllowedCount,
    },
    metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      pathOriginStartup.ok &&
      tooManyOriginsStartup.ok &&
      oversizedOriginStartup.ok &&
      health === "ok" &&
      missingSession.status === 403 &&
      wrongSession.status === 403 &&
      allowedSession.status === 200 &&
      missingWs.statusLine.includes("403") &&
      wrongWs.statusLine.includes("403") &&
      allowedWs.statusLine.includes("101") &&
      summary.originAllowlistEnabled === true &&
      summary.originAllowedCount === 1 &&
      metrics.sundermere_origin_allowlist_enabled === 1 &&
      metrics.sundermere_origin_allowed_origins === 1 &&
      metrics.sundermere_origin_rejected_total === 4,
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
