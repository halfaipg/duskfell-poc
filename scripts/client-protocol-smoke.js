import { performance } from "node:perf_hooks";

import { parseServerMessage } from "../client/server-messages.js";

const args = parseArgs(process.argv.slice(2));
const url = args.url ?? "ws://127.0.0.1:4107/ws";
const timeoutMs = Number(args.timeoutMs ?? 5000);

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error("--timeoutMs must be positive");
}

const startedAt = performance.now();
const session = await issueSession(new URL(url));
const wsUrl = new URL(url);
wsUrl.searchParams.set("session", session.sessionToken);

let socket;
let parsedWelcome = null;
let parsedSnapshot = null;
let closed = false;
let error = null;

try {
  socket = new WebSocket(wsUrl);
  await runSmoke();
} catch (err) {
  error = err;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.close(1000, "client-protocol-smoke-complete");
  }
}

const elapsedMs = performance.now() - startedAt;
const result = {
  url,
  sessionId: session.sessionId,
  playerId: parsedWelcome?.playerId ?? null,
  identityMatched: session.sessionId === parsedWelcome?.playerId,
  welcomePlayers: parsedWelcome?.snapshot.players.length ?? 0,
  welcomeNpcs: parsedWelcome?.snapshot.npcs.length ?? 0,
  welcomeObjects: parsedWelcome?.snapshot.objects.length ?? 0,
  firstPlayerColor: parsedWelcome?.snapshot.players[0]?.color ?? null,
  snapshotTick: parsedSnapshot?.tick ?? null,
  elapsedMs: round(elapsedMs),
  closed,
  error: error?.message ?? null,
};

console.log(JSON.stringify(result, null, 2));

if (
  error ||
  !result.identityMatched ||
  result.welcomePlayers < 1 ||
  result.welcomeNpcs < 1 ||
  result.welcomeObjects < 1 ||
  !/^#[0-9a-f]{6}$/i.test(result.firstPlayerColor) ||
  parsedSnapshot == null
) {
  process.exitCode = 1;
}

async function runSmoke() {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("client protocol smoke timed out"));
    }, timeoutMs);

    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = parseServerMessage(event.data);
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
        return;
      }

      if (message.type === "welcome") {
        parsedWelcome = message;
        socket.send(
          JSON.stringify({
            type: "input",
            seq: 1,
            up: false,
            down: false,
            left: false,
            right: false,
            interact: false,
          }),
        );
      } else if (message.type === "snapshot") {
        parsedSnapshot = message;
        clearTimeout(timeout);
        resolve();
      }
    });

    socket.addEventListener("close", () => {
      closed = true;
    });

    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("websocket error"));
    });
  });
}

async function issueSession(wsUrl) {
  const sessionUrl = new URL("/api/session", wsUrl);
  sessionUrl.protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
  const response = await fetch(sessionUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`session issue failed: ${response.status}`);
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

function round(value) {
  return Math.round(value * 100) / 100;
}
