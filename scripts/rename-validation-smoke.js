import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4125);
const timeoutMs = Number(args.timeoutMs ?? 8000);
const runtimeDir = path.resolve("var", "rename-validation-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;
const spawnName = "Launch_7";
const validName = "Scout_7";
const invalidName = "Scout<script>";

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error("--timeoutMs must be positive");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let socket = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  const rejectedSession = await issueSession({ name: invalidName });
  const unknownFieldSession = await issueSession({ name: "Scout_Extra", admin: true });
  const session = await issueSession({ name: `  ${spawnName}  ` });
  const duplicatePendingSession = await issueSession({ name: spawnName.toLowerCase() });
  const url = new URL(wsUrl);
  url.searchParams.set("session", session.body.sessionToken);
  socket = new WebSocket(url);
  const socketResult = await runRenameFlow(socket, session.body.sessionId);
  const duplicateActiveSession = await issueSession({ name: validName });
  const metrics = parseMetrics(await fetchText("/metrics"), [
    "sundermere_ws_messages_rejected_total",
    "sundermere_ws_messages_in_total",
    "sundermere_session_request_invalid_total",
    "sundermere_session_display_name_invalid_total",
    "sundermere_session_display_name_conflict_total",
  ]);
  const events = await fetchJson("/admin/events?limit=20");
  const invalidRenameEvent = events.find(
    (event) =>
      event.kind?.type === "clientMessageRejected" &&
      event.kind.reason === "invalid-player-name invalid-characters",
  );

  result = {
    port,
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
    ...socketResult,
    metrics,
    invalidRenameJournaled: Boolean(invalidRenameEvent),
    elapsedMs: round(performance.now() - startedAt),
    ok:
      rejectedSession.status === 400 &&
      rejectedSession.body.includes("invalid-player-name") &&
      unknownFieldSession.status === 400 &&
      unknownFieldSession.body.includes("invalid session request JSON") &&
      session.status === 200 &&
      session.body.displayName === spawnName &&
      duplicatePendingSession.status === 409 &&
      duplicatePendingSession.body.includes("already-reserved") &&
      duplicateActiveSession.status === 409 &&
      duplicateActiveSession.body.includes("already-active") &&
      socketResult.identityMatched &&
      socketResult.spawnNameObserved &&
      socketResult.validRenameObserved &&
      socketResult.invalidRenamePreservedName &&
      metrics.sundermere_ws_messages_in_total === 2 &&
      metrics.sundermere_ws_messages_rejected_total >= 1 &&
      metrics.sundermere_session_request_invalid_total === 1 &&
      metrics.sundermere_session_display_name_invalid_total === 1 &&
      metrics.sundermere_session_display_name_conflict_total === 2 &&
      Boolean(invalidRenameEvent),
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
    socket.close(1000, "rename-validation-smoke-complete");
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
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
      REQUIRE_SESSION: "true",
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth(child);
  return child;
}

async function runRenameFlow(ws, expectedPlayerId) {
  let playerId = null;
  let spawnNameObserved = false;
  let validRenameObserved = false;
  let invalidRenameSent = false;
  let invalidRenamePreservedName = false;
  let snapshotsAfterInvalid = 0;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("rename validation smoke timed out"));
    }, timeoutMs);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "rename", name: validName }));
    });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome") {
        playerId = message.playerId;
        const me = message.snapshot.players.find((player) => player.id === playerId);
        spawnNameObserved = me?.name === spawnName;
        return;
      }
      if (message.type !== "snapshot" || !playerId) return;

      const me = message.players.find((player) => player.id === playerId);
      if (!me) return;

      if (!validRenameObserved && me.name === validName) {
        validRenameObserved = true;
        ws.send(JSON.stringify({ type: "rename", name: invalidName }));
        invalidRenameSent = true;
        return;
      }

      if (invalidRenameSent) {
        snapshotsAfterInvalid += 1;
        if (me.name === validName) {
          invalidRenamePreservedName = true;
        }
        if (snapshotsAfterInvalid >= 2) {
          clearTimeout(timeout);
          resolve();
        }
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("websocket error"));
    });
    ws.addEventListener("close", () => {
      clearTimeout(timeout);
      reject(new Error("websocket closed before rename validation completed"));
    });
  });

  return {
    sessionId: expectedPlayerId,
    playerId,
    identityMatched: playerId === expectedPlayerId,
    spawnNameObserved,
    validRenameObserved,
    invalidRenamePreservedName,
  };
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

async function issueSession(payload) {
  const response = await fetch(`${httpUrl}/api/session`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: parseMaybeJson(text) ?? text,
  };
}

async function fetchJson(endpoint) {
  const response = await fetch(`${httpUrl}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.json();
}

async function fetchText(endpoint) {
  const response = await fetch(`${httpUrl}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.text();
}

function parseMetrics(text, names) {
  const metrics = {};
  for (const name of names) {
    const match = text.match(new RegExp(`^${name} ([0-9]+)$`, "m"));
    metrics[name] = match ? Number(match[1]) : Number.NaN;
  }
  return metrics;
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
