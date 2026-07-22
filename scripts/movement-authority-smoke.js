import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

import { parseServerMessage } from "../client/server-messages.js";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4131);
const moveMs = Number(args.moveMs ?? 850);
const runtimeDir = path.resolve("var", "movement-authority-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}
if (!Number.isFinite(moveMs) || moveMs <= 0) {
  throw new Error("--moveMs must be positive");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  const cardinal = await runMovement({ up: true });
  const diagonal = await runMovement({ up: true, right: true });
  const ratio = diagonal.distance / cardinal.distance;

  result = {
    port,
    moveMs,
    cardinal,
    diagonal,
    ratio: round(ratio),
    elapsedMs: round(performance.now() - startedAt),
    ok:
      cardinal.identityMatched &&
      diagonal.identityMatched &&
      cardinal.distance > 120 &&
      diagonal.distance > 120 &&
      ratio >= 0.9 &&
      ratio <= 1.1 &&
      Math.abs(cardinal.dx) < 1 &&
      cardinal.dy < 0 &&
      diagonal.dx > 0 &&
      diagonal.dy < 0,
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

async function runMovement(input) {
  const session = await issueSession();
  const url = new URL(wsUrl);
  url.searchParams.set("session", session.sessionToken);
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  let seq = 0;
  let playerId = null;
  let start = null;
  let latest = null;
  let startTick = null;
  let latestTick = null;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("movement authority smoke timed out"));
    }, moveMs + 5000);

    ws.addEventListener("message", (event) => {
      const message = parseServerMessage(event.data);
      const snapshot = message.type === "welcome" ? message.snapshot : message;
      if (message.type === "welcome") {
        playerId = message.playerId;
      }
      if (!playerId || !snapshot?.players) return;

      const me = snapshot.players.find((player) => player.id === playerId);
      if (!me) return;

      latest = { x: me.x, y: me.y };
      latestTick = snapshot.tick;
      if (!start) {
        start = latest;
        startTick = snapshot.tick;
        sendInput(ws, ++seq, input);
        setTimeout(() => {
          sendInput(ws, ++seq, {});
          setTimeout(() => {
            clearTimeout(timeout);
            ws.close(1000, "movement-authority-smoke-complete");
            resolve();
          }, 180);
        }, moveMs);
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("websocket error"));
    });
    ws.addEventListener("close", () => {
      clearTimeout(timeout);
    });
  });

  const dx = latest.x - start.x;
  const dy = latest.y - start.y;
  return {
    sessionId: session.sessionId,
    playerId,
    identityMatched: session.sessionId === playerId,
    start,
    latest,
    startTick,
    latestTick,
    dx: round(dx),
    dy: round(dy),
    distance: round(Math.hypot(dx, dy)),
  };
}

function sendInput(ws, seq, input) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(
    JSON.stringify({
      type: "input",
      seq,
      up: Boolean(input.up),
      down: Boolean(input.down),
      left: Boolean(input.left),
      right: Boolean(input.right),
      interact: false,
    }),
  );
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
