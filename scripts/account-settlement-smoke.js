import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4162);
const runtimeDir = path.resolve("var", "account-settlement-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;
const adminToken = `account-settlement-admin-${runId}`;
const secret = `account-settlement-secret-${runId}`;
const issuer = "https://identity.example";
const audience = "duskfell";
const accountSubject = "acct:wallet:0xabc123";

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let socket = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  const token = signJwt({
    sub: accountSubject,
    iss: issuer,
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 120,
  });
  const session = await issueSession(token);
  const claimed = await claimDeed(session.sessionToken);
  await sleep(150);

  const [ownership, events] = await Promise.all([
    fetchJson("/admin/ownership"),
    fetchJson("/admin/events?limit=40"),
  ]);
  const ownershipReceipt = ownership.find((receipt) => receipt.assetId === claimed.claimedDeed);
  const joinEvent = events.find(
    (event) =>
      event.kind?.type === "playerJoined" &&
      event.kind.playerId === claimed.playerId &&
      event.kind.accountSubject === accountSubject,
  );
  const claimEvent = events.find(
    (event) =>
      event.kind?.type === "ownershipClaimed" &&
      event.kind.assetId === claimed.claimedDeed &&
      event.kind.accountSubject === accountSubject,
  );

  result = {
    port,
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
      session.accountSubject === accountSubject &&
      session.sessionId === claimed.playerId &&
      claimed.snapshotAccountSubject === accountSubject &&
      claimed.confirmedReceipt?.assetId === claimed.claimedDeed &&
      claimed.confirmedReceipt?.accountSubject === accountSubject &&
      ownershipReceipt?.accountSubject === accountSubject &&
      Boolean(joinEvent) &&
      Boolean(claimEvent),
  };
} catch (err) {
  result = {
    port,
    elapsedMs: round(performance.now() - startedAt),
    ok: false,
    error: err.message,
    serverExitCode: server?.exitCode ?? null,
  };
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.close(1000, "account-settlement-smoke-complete");
  }
  if (server) {
    await stopServer(server);
  }
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) {
  process.exitCode = 1;
}

async function startServer() {
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${port}`,
      REQUIRE_SESSION: "true",
      REQUIRE_ACCOUNT: "true",
      ACCOUNT_AUTH_MODE: "jwt-hs256",
      ACCOUNT_JWT_HS256_SECRET: secret,
      ACCOUNT_JWT_ISSUER: issuer,
      ACCOUNT_JWT_AUDIENCE: audience,
      ADMIN_TOKEN: adminToken,
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth(child);
  return child;
}

async function issueSession(jwt) {
  const response = await fetch(`${httpUrl}/api/session`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Bound_7" }),
  });
  if (!response.ok) {
    throw new Error(`/api/session returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function claimDeed(sessionToken) {
  const url = new URL(wsUrl);
  url.searchParams.set("session", sessionToken);
  socket = new WebSocket(url);
  let seq = 0;
  let playerId = null;
  let snapshotAccountSubject = null;
  let claimedDeed = null;
  let confirmedReceipt = null;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("account settlement smoke timed out")), 8000);

    socket.addEventListener("open", () => sendInput({}));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const snapshot = message.type === "welcome" ? message.snapshot : message;
      if (message.type === "welcome") {
        playerId = message.playerId;
      }
      if (!snapshot?.players || !playerId) return;

      const me = snapshot.players.find((player) => player.id === playerId);
      const registrar = snapshot.objects.find((object) => object.id === "registrar");
      if (!me || !registrar) return;
      snapshotAccountSubject = me.accountSubject ?? null;

      const deed = me.demoDeeds.find((assetId) => assetId.startsWith("dryrun-deed-"));
      if (deed) {
        claimedDeed = deed;
        sendInput({});
      } else {
        steerToward(me, registrar, sendInput);
      }

      const receipt = snapshot.settlement.latestReceipt;
      if (claimedDeed && receipt?.assetId === claimedDeed) {
        confirmedReceipt = receipt;
        clearTimeout(timeout);
        resolve();
      }
    });
    socket.addEventListener("close", () => {
      if (!confirmedReceipt) {
        clearTimeout(timeout);
        reject(new Error("websocket closed before account-bound receipt"));
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("websocket error"));
    });
  });

  return {
    playerId,
    snapshotAccountSubject,
    claimedDeed,
    confirmedReceipt,
  };

  function sendInput(input) {
    if (socket.readyState !== WebSocket.OPEN) return;
    seq += 1;
    socket.send(
      JSON.stringify({
        type: "input",
        seq,
        up: Boolean(input.up),
        down: Boolean(input.down),
        left: Boolean(input.left),
        right: Boolean(input.right),
        interact: Boolean(input.interact),
      }),
    );
  }
}

function steerToward(me, target, sendInput) {
  const dx = target.x - me.x;
  const dy = target.y - me.y;
  const distance = Math.hypot(dx, dy);
  const interact = distance <= 58;
  sendInput({
    up: dy < -8 && !interact,
    down: dy > 8 && !interact,
    left: dx < -8 && !interact,
    right: dx > 8 && !interact,
    interact,
  });
}

async function fetchJson(endpoint) {
  const response = await fetch(`${httpUrl}${endpoint}`, {
    headers: {
      "x-admin-token": adminToken,
    },
  });
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.json();
}

async function waitForHealth(child) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited during startup with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${httpUrl}/healthz`);
      if (response.ok && (await response.text()) === "ok") {
        return;
      }
    } catch {
      // Retry until the startup deadline.
    }
    await sleep(120);
  }
  throw new Error(`server did not become healthy on ${httpUrl}`);
}

async function stopServer(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGINT");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3000).then(() => {
      if (child.exitCode == null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

function signJwt(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    parsed[key] = inlineValue ?? rawArgs[index + 1];
    if (inlineValue == null) index += 1;
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
