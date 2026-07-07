import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4137);
const runtimeDir = path.resolve("var", "ws-ingress-config-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;
const adminToken = `ws-ingress-config-${runId}`;
const wsMaxTextBytes = 128;
const wsMessageBurst = 2;
const wsMessageRefillPerSecond = 1;
const wsMaxInputSequenceStep = 10;
const clientRejectLimit = 3;

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  const oversized = await sendOversizedFrame();
  const rateLimited = await sendBurstUntilClose();
  await waitForRejectedMessages(clientRejectLimit + 1);

  const [summary, metricsText, events] = await Promise.all([
    fetchJson("/admin/summary"),
    fetchText("/metrics"),
    fetchJson("/admin/events?limit=20"),
  ]);
  const metrics = parseMetrics(metricsText, [
    "sundermere_ws_messages_rejected_total",
    "sundermere_ws_messages_rejected_message_too_large_total",
    "sundermere_ws_messages_rejected_rate_limited_total",
    "sundermere_ws_messages_in_total",
    "sundermere_ws_max_text_bytes",
    "sundermere_ws_message_burst",
    "sundermere_ws_message_refill_per_second",
    "sundermere_ws_max_input_sequence_step",
    "sundermere_client_reject_limit",
  ]);
  const oversizedEvent = events.find((event) =>
    event.kind?.reason?.startsWith(
      `message-too-large bytes=${oversized.bytes} max=${wsMaxTextBytes}`,
    ),
  );
  const rateLimitedEvents = events.filter(
    (event) => event.kind?.type === "clientMessageRejected" && event.kind.reason === "rate-limited",
  );

  result = {
    port,
    oversized,
    rateLimited,
    summary: {
      websocketMaxTextBytes: summary.websocketMaxTextBytes,
      websocketMessageBurst: summary.websocketMessageBurst,
      websocketMessageRefillPerSecond: summary.websocketMessageRefillPerSecond,
      websocketMaxInputSequenceStep: summary.websocketMaxInputSequenceStep,
      clientRejectLimit: summary.clientRejectLimit,
    },
    metrics,
    oversizedJournaled: Boolean(oversizedEvent),
    rateLimitedJournalEvents: rateLimitedEvents.length,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      oversized.identityMatched &&
      rateLimited.identityMatched &&
      rateLimited.closed &&
      summary.websocketMaxTextBytes === wsMaxTextBytes &&
      summary.websocketMessageBurst === wsMessageBurst &&
      summary.websocketMessageRefillPerSecond === wsMessageRefillPerSecond &&
      summary.websocketMaxInputSequenceStep === wsMaxInputSequenceStep &&
      summary.clientRejectLimit === clientRejectLimit &&
      metrics.sundermere_ws_max_text_bytes === wsMaxTextBytes &&
      metrics.sundermere_ws_message_burst === wsMessageBurst &&
      metrics.sundermere_ws_message_refill_per_second === wsMessageRefillPerSecond &&
      metrics.sundermere_ws_max_input_sequence_step === wsMaxInputSequenceStep &&
      metrics.sundermere_client_reject_limit === clientRejectLimit &&
      metrics.sundermere_ws_messages_rejected_total >= clientRejectLimit + 1 &&
      metrics.sundermere_ws_messages_rejected_message_too_large_total === 1 &&
      metrics.sundermere_ws_messages_rejected_rate_limited_total >= clientRejectLimit &&
      metrics.sundermere_ws_messages_in_total >= wsMessageBurst &&
      Boolean(oversizedEvent) &&
      rateLimitedEvents.length >= clientRejectLimit,
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
      ADMIN_TOKEN: adminToken,
      REQUIRE_SESSION: "true",
      WS_MAX_TEXT_BYTES: String(wsMaxTextBytes),
      WS_MESSAGE_BURST: String(wsMessageBurst),
      WS_MESSAGE_REFILL_PER_SECOND: String(wsMessageRefillPerSecond),
      WS_MAX_INPUT_SEQUENCE_STEP: String(wsMaxInputSequenceStep),
      CLIENT_REJECT_LIMIT: String(clientRejectLimit),
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth(child);
  return child;
}

async function sendOversizedFrame() {
  const { socket, session, playerId } = await connectWithSession();
  const payload = JSON.stringify({ type: "rename", name: "A".repeat(160) });
  socket.send(payload);
  await sleep(250);
  socket.close(1000, "ws-ingress-config-oversized-complete");
  await waitForClose(socket);

  return {
    sessionId: session.sessionId,
    playerId,
    identityMatched: playerId === session.sessionId,
    bytes: Buffer.byteLength(payload),
  };
}

async function sendBurstUntilClose() {
  const { socket, session, playerId } = await connectWithSession();
  for (let index = 0; index < wsMessageBurst + clientRejectLimit; index += 1) {
    socket.send(JSON.stringify({ type: "rename", name: `R_${index}` }));
  }
  const closed = await waitForClose(socket, 5000);

  return {
    sessionId: session.sessionId,
    playerId,
    identityMatched: playerId === session.sessionId,
    sentMessages: wsMessageBurst + clientRejectLimit,
    closed,
  };
}

async function connectWithSession() {
  const session = await issueSession();
  const socketUrl = new URL(wsUrl);
  socketUrl.searchParams.set("session", session.sessionToken);
  const socket = new WebSocket(socketUrl);
  let playerId = null;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket welcome timed out")), 5000);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome") {
        playerId = message.playerId;
        clearTimeout(timer);
        resolve();
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket failed"));
    });
    socket.addEventListener("close", () => {
      clearTimeout(timer);
      reject(new Error("websocket closed before welcome"));
    });
  });

  return { socket, session, playerId };
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

async function waitForRejectedMessages(minimum) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const metrics = parseMetrics(await fetchText("/metrics"), [
      "sundermere_ws_messages_rejected_total",
    ]);
    if (metrics.sundermere_ws_messages_rejected_total >= minimum) {
      return metrics;
    }
    await sleep(120);
  }
  throw new Error(`rejected message count did not reach ${minimum}`);
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

async function waitForClose(socket, timeoutMs = 1000) {
  if (socket.readyState === WebSocket.CLOSED) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(socket.readyState === WebSocket.CLOSED), timeoutMs);
    socket.addEventListener("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
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
