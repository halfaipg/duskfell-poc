import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { decodeMsgpack } from "../client/msgpack-decode.js";

function decodeServerFrame(data) {
  if (data instanceof ArrayBuffer) return hydrateUuids(decodeMsgpack(new Uint8Array(data)));
  if (ArrayBuffer.isView(data)) {
    return hydrateUuids(decodeMsgpack(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
  }
  return JSON.parse(String(data));
}

// MessagePack frames carry UUIDs as 16 raw bytes; smokes compare ids as
// strings, so format them like the JSON protocol did.
function hydrateUuids(value) {
  if (value instanceof Uint8Array && value.byteLength === 16) {
    const hex = [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  if (Array.isArray(value)) return value.map(hydrateUuids);
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    for (const key of Object.keys(value)) {
      value[key] = hydrateUuids(value[key]);
    }
  }
  return value;
}

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4122);
const startupTimeoutMs = Number(args.startupTimeoutMs ?? 10000);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const runtimeDir = path.resolve("var", "journal-replay-smoke");
const journalPath = path.join(runtimeDir, `${runId}-journal.jsonl`);
const outboxPath = path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`);
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  const firstConnection = await connectAndClose();
  const connected = await connectAndClose();
  const beforeRestartSummary = await waitForJournalEvents(2);
  await stopServer(server);
  server = null;

  server = await startServer();
  const [afterRestartSummary, events] = await Promise.all([
    fetchJson("/admin/summary"),
    fetchJson("/admin/events?limit=10"),
  ]);
  const joinedEvent = events.find(
    (event) =>
      event.kind?.type === "playerJoined" && event.kind.playerId === connected.playerId,
  );
  const leftEvent = events.find(
    (event) => event.kind?.type === "playerLeft" && event.kind.playerId === connected.playerId,
  );
  const oldJoinedEvent = events.find(
    (event) =>
      event.kind?.type === "playerJoined" && event.kind.playerId === firstConnection.playerId,
  );

  result = {
    port,
    journalPath,
    firstPlayerId: firstConnection.playerId,
    playerId: connected.playerId,
    beforeRestartJournalEvents: beforeRestartSummary.journalEvents,
    beforeRestartJournalLastSequence: beforeRestartSummary.journalLastSequence,
    afterRestartJournalEvents: afterRestartSummary.journalEvents,
    afterRestartJournalRetainedCapacity: afterRestartSummary.journalRetainedCapacity,
    afterRestartJournalReplayedTotalEvents: afterRestartSummary.journalReplayedTotalEvents,
    afterRestartJournalLastSequence: afterRestartSummary.journalLastSequence,
    replayedEvents: events,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      connected.identityMatched &&
      firstConnection.identityMatched &&
      beforeRestartSummary.journalEvents >= 2 &&
      beforeRestartSummary.journalLastSequence >= 4 &&
      afterRestartSummary.journalEvents === 2 &&
      afterRestartSummary.journalRetainedCapacity === 2 &&
      afterRestartSummary.journalReplayedTotalEvents >= 4 &&
      afterRestartSummary.journalLastSequence >= 4 &&
      Boolean(joinedEvent) &&
      Boolean(leftEvent) &&
      !oldJoinedEvent,
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

async function startServer() {
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${port}`,
      REQUIRE_SESSION: "true",
      JOURNAL_RETAINED_EVENTS: "2",
      JOURNAL_PATH: journalPath,
      SETTLEMENT_OUTBOX_PATH: outboxPath,
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth(child);
  return child;
}

async function waitForHealth(child) {
  const deadline = performance.now() + startupTimeoutMs;
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

async function connectAndClose() {
  const session = await issueSession();
  const socketUrl = new URL(wsUrl);
  socketUrl.searchParams.set("session", session.sessionToken);
  const socket = new WebSocket(socketUrl);
  socket.binaryType = "arraybuffer";
  let playerId = null;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket welcome timed out")), 5000);
    socket.addEventListener("message", (event) => {
      const message = decodeServerFrame(event.data);
      if (message.type === "welcome") {
        playerId = message.playerId;
        clearTimeout(timer);
        socket.close(1000, "journal-replay-smoke-complete");
        resolve();
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket failed"));
    });
  });

  await new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, 1000);
    socket.addEventListener("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });

  return {
    playerId,
    identityMatched: playerId === session.sessionId,
  };
}

async function issueSession() {
  const response = await fetch(`${httpUrl}/api/session`, {
    method: "POST",
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`/api/session returned ${response.status}`);
  }
  return response.json();
}

async function waitForJournalEvents(minimum) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const summary = await fetchJson("/admin/summary");
    if (summary.journalEvents >= minimum) {
      return summary;
    }
    await sleep(120);
  }
  throw new Error(`journal did not reach ${minimum} events`);
}

async function fetchJson(endpoint) {
  const response = await fetch(`${httpUrl}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.json();
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
