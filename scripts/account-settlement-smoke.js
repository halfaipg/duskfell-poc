import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { signJwt } from "./account-settlement-smoke/auth.js";
import { createAccountSettlementContext, round } from "./account-settlement-smoke/config.js";
import { fetchAdminJson, issueSession } from "./account-settlement-smoke/http.js";
import { startServer, stopServer } from "./account-settlement-smoke/server.js";
import { claimDeed } from "./account-settlement-smoke/websocket.js";

const context = createAccountSettlementContext(process.argv.slice(2));

await mkdir(context.runtimeDir, { recursive: true });

let server = null;
let claimed = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer(context);
  const token = signJwt(context, {
    sub: context.accountSubject,
    iss: context.issuer,
    aud: context.audience,
    exp: Math.floor(Date.now() / 1000) + 120,
  });
  const session = await issueSession(context, token);
  claimed = await claimDeed(context, session.sessionToken);
  await sleep(150);

  const [ownership, events] = await Promise.all([
    fetchAdminJson(context, "/admin/ownership"),
    fetchAdminJson(context, "/admin/events?limit=40"),
  ]);
  const ownershipReceipt = ownership.find((receipt) => receipt.assetId === claimed.claimedDeed);
  const joinEvent = events.find(
    (event) =>
      event.kind?.type === "playerJoined" &&
      event.kind.playerId === claimed.playerId &&
      event.kind.accountSubject === context.accountSubject,
  );
  const claimEvent = events.find(
    (event) =>
      event.kind?.type === "ownershipClaimed" &&
      event.kind.assetId === claimed.claimedDeed &&
      event.kind.accountSubject === context.accountSubject,
  );

  result = {
    port: context.port,
    session: {
      sessionId: session.sessionId,
      accountSubject: session.accountSubject,
    },
    playerId: claimed.playerId,
    snapshotAccountSubject: claimed.snapshotAccountSubject,
    claimedDeed: claimed.claimedDeed,
    receipt: claimed.confirmedReceipt,
    ownershipReceipt,
    journal: {
      joinedWithAccountSubject: Boolean(joinEvent),
      claimWithAccountSubject: Boolean(claimEvent),
    },
    elapsedMs: round(performance.now() - startedAt),
    ok:
      session.accountSubject === context.accountSubject &&
      session.sessionId === claimed.playerId &&
      claimed.snapshotAccountSubject === context.accountSubject &&
      claimed.confirmedReceipt?.assetId === claimed.claimedDeed &&
      claimed.confirmedReceipt?.accountSubject === context.accountSubject &&
      ownershipReceipt?.accountSubject === context.accountSubject &&
      Boolean(joinEvent) &&
      Boolean(claimEvent),
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
  claimed?.close?.();
  if (server) {
    await stopServer(server);
  }
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) {
  process.exitCode = 1;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
