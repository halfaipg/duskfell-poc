import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4127);
const runtimeDir = path.resolve("var", "ws-reject-limit-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;

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
  const session = await issueSession();
  const url = new URL(wsUrl);
  url.searchParams.set("session", session.body.sessionToken);
  socket = new WebSocket(url);
  const closeObserved = await sendBadMessagesUntilClose(socket);
  await sleep(150);

  const metrics = parseMetrics(await fetchText("/metrics"), [
    "sundermere_active_connections",
    "sundermere_ws_messages_rejected_total",
    "sundermere_ws_messages_rejected_stale_input_sequence_total",
    "sundermere_ws_messages_rejected_input_sequence_jump_total",
    "sundermere_client_reject_limit",
    "sundermere_ws_max_input_sequence_step",
  ]);
  const summary = await fetchJson("/admin/summary");
  const events = await fetchJson("/admin/events?limit=20");
  const badMessages = events.filter((event) => event.kind?.type === "badClientMessage");
  const staleInputEvents = events.filter(
    (event) =>
      event.kind?.type === "clientMessageRejected" &&
      event.kind.reason === "stale-input-sequence seq=1 last=1",
  );
  const sequenceJumpEvents = events.filter(
    (event) =>
      event.kind?.type === "clientMessageRejected" &&
      event.kind.reason === "input-sequence-jump seq=50 last=1 max-step=10",
  );

  result = {
    port,
    sessionStatus: session.status,
    closeObserved,
    metrics,
    summary: {
      activeConnections: summary.activeConnections,
      clientRejectLimit: summary.clientRejectLimit,
      websocketMaxInputSequenceStep: summary.websocketMaxInputSequenceStep,
    },
    badMessageEvents: badMessages.length,
    staleInputEvents: staleInputEvents.length,
    sequenceJumpEvents: sequenceJumpEvents.length,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      session.status === 200 &&
      closeObserved &&
      metrics.sundermere_active_connections === 0 &&
      metrics.sundermere_ws_messages_rejected_total === 3 &&
      metrics.sundermere_ws_messages_rejected_stale_input_sequence_total === 1 &&
      metrics.sundermere_ws_messages_rejected_input_sequence_jump_total === 1 &&
      metrics.sundermere_client_reject_limit === 3 &&
      metrics.sundermere_ws_max_input_sequence_step === 10 &&
      summary.activeConnections === 0 &&
      summary.clientRejectLimit === 3 &&
      summary.websocketMaxInputSequenceStep === 10 &&
      badMessages.length >= 1 &&
      staleInputEvents.length >= 1 &&
      sequenceJumpEvents.length >= 1,
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
    socket.close(1000, "ws-reject-limit-smoke-complete");
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
      CLIENT_REJECT_LIMIT: "3",
      WS_MAX_INPUT_SEQUENCE_STEP: "10",
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth(child);
  return child;
}

async function sendBadMessagesUntilClose(ws) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("websocket did not close after reject limit"));
    }, 5000);

    ws.addEventListener("open", () => {
      const input = {
        type: "input",
        seq: 1,
        up: false,
        down: false,
        left: false,
        right: false,
        interact: false,
      };
      ws.send(JSON.stringify(input));
      ws.send(JSON.stringify(input));
      ws.send(JSON.stringify({ ...input, seq: 50 }));
      ws.send("{not-json");
    });
    ws.addEventListener("close", () => {
      clearTimeout(timeout);
      resolve(true);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("websocket error"));
    });
  });
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
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function fetchText(endpoint) {
  const response = await fetch(`${httpUrl}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.text();
}

async function fetchJson(endpoint) {
  const response = await fetch(`${httpUrl}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.json();
}

function parseMetrics(text, names) {
  const metrics = {};
  for (const name of names) {
    const match = text.match(new RegExp(`^${name} ([0-9]+)$`, "m"));
    metrics[name] = match ? Number(match[1]) : Number.NaN;
  }
  return metrics;
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
