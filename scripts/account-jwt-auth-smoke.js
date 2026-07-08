import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { createJwtAuthContext, round } from "./account-jwt-auth-smoke/config.js";
import { createJwtTestTokens } from "./account-jwt-auth-smoke/jwt.js";
import { fetchJson, fetchText, issueSession, parseMetrics } from "./account-jwt-auth-smoke/http.js";
import { startServer, stopServer } from "./account-jwt-auth-smoke/server.js";

const context = createJwtAuthContext(process.argv.slice(2));

await mkdir(context.runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer(context);
  const tokens = createJwtTestTokens(context);

  const missing = await issueSession(context);
  const wrongSignature = await issueSession(context, {
    authorization: `Bearer ${tokens.wrongSignature}`,
  });
  const expired = await issueSession(context, {
    authorization: `Bearer ${tokens.expired}`,
  });
  const wrongAudience = await issueSession(context, {
    authorization: `Bearer ${tokens.wrongAudience}`,
  });
  const emptySubject = await issueSession(context, {
    authorization: `Bearer ${tokens.emptySubject}`,
  });
  const oversized = await issueSession(context, {
    authorization: `Bearer ${context.oversizedToken}`,
  });
  const correct = await issueSession(context, {
    authorization: `Bearer ${tokens.correct}`,
    body: JSON.stringify({ name: "Jwt_7" }),
    contentType: "application/json",
  });
  const summary = await fetchJson(context, "/admin/summary");
  const metrics = parseMetrics(await fetchText(context, "/metrics"), [
    "sundermere_account_auth_rejected_total",
    "sundermere_session_tickets_issued_total",
    "sundermere_session_pending_tickets",
    "sundermere_require_account",
    "sundermere_dev_account_token_configured",
    "sundermere_account_auth_mode_dev_token",
    "sundermere_account_auth_mode_jwt_hs256",
    "sundermere_account_jwt_issuer_configured",
    "sundermere_account_jwt_audience_configured",
  ]);

  result = {
    port: context.port,
    statuses: {
      missing: missing.status,
      wrongSignature: wrongSignature.status,
      expired: expired.status,
      wrongAudience: wrongAudience.status,
      emptySubject: emptySubject.status,
      oversized: oversized.status,
      correct: correct.status,
    },
    correctBody: correct.body,
    summary: {
      requireAccount: summary.requireAccount,
      accountAuthMode: summary.accountAuthMode,
      devAccountTokenConfigured: summary.devAccountTokenConfigured,
      accountJwtIssuerConfigured: summary.accountJwtIssuerConfigured,
      accountJwtAudienceConfigured: summary.accountJwtAudienceConfigured,
      sessionPendingTickets: summary.sessionPendingTickets,
    },
    metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      missing.status === 401 &&
      wrongSignature.status === 401 &&
      expired.status === 401 &&
      wrongAudience.status === 401 &&
      emptySubject.status === 401 &&
      oversized.status === 401 &&
      correct.status === 200 &&
      correct.body?.displayName === "Jwt_7" &&
      correct.body?.accountSubject === context.subject &&
      correct.body?.requireAccount === true &&
      summary.requireAccount === true &&
      summary.accountAuthMode === "jwt-hs256" &&
      summary.devAccountTokenConfigured === false &&
      summary.accountJwtIssuerConfigured === true &&
      summary.accountJwtAudienceConfigured === true &&
      summary.sessionPendingTickets === 1 &&
      metrics.sundermere_account_auth_rejected_total === 6 &&
      metrics.sundermere_session_tickets_issued_total === 1 &&
      metrics.sundermere_session_pending_tickets === 1 &&
      metrics.sundermere_require_account === 1 &&
      metrics.sundermere_dev_account_token_configured === 0 &&
      metrics.sundermere_account_auth_mode_dev_token === 0 &&
      metrics.sundermere_account_auth_mode_jwt_hs256 === 1 &&
      metrics.sundermere_account_jwt_issuer_configured === 1 &&
      metrics.sundermere_account_jwt_audience_configured === 1,
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
