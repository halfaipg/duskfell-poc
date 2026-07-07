import crypto from "node:crypto";
import net from "node:net";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4126);
const runtimeDir = path.resolve("var", "ws-binary-reject-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  const session = await issueSession();
  const rawSocket = await openRawWebSocket(session.body.sessionToken);
  rawSocket.socket.write(maskedBinaryFrame(Buffer.from([0xde, 0xad, 0xbe, 0xef])));
  await waitForSocketClose(rawSocket.socket, 3000);
  await sleep(150);

  const metrics = parseMetrics(await fetchText("/metrics"), [
    "sundermere_active_connections",
    "sundermere_ws_messages_rejected_total",
    "sundermere_ws_messages_rejected_unsupported_binary_total",
  ]);
  const events = await fetchJson("/admin/events?limit=20");
  const binaryRejectEvent = events.find(
    (event) =>
      event.kind?.type === "clientMessageRejected" &&
      event.kind.reason === "unsupported-binary-frame bytes=4",
  );

  result = {
    port,
    sessionStatus: session.status,
    handshakeStatus: rawSocket.statusLine,
    closeObserved: rawSocket.isClosed(),
    metrics,
    binaryRejectJournaled: Boolean(binaryRejectEvent),
    elapsedMs: round(performance.now() - startedAt),
    ok:
      session.status === 200 &&
      rawSocket.statusLine.includes("101") &&
      rawSocket.isClosed() === true &&
      metrics.sundermere_active_connections === 0 &&
      metrics.sundermere_ws_messages_rejected_total === 1 &&
      metrics.sundermere_ws_messages_rejected_unsupported_binary_total === 1 &&
      Boolean(binaryRejectEvent),
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

async function openRawWebSocket(sessionToken) {
  const socket = new net.Socket();
  let closed = false;
  socket.once("close", () => {
    closed = true;
  });

  await new Promise((resolve, reject) => {
    function onConnect() {
      cleanup();
      resolve();
    }
    function onError(err) {
      cleanup();
      reject(err);
    }
    function cleanup() {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    }
    socket.once("connect", onConnect);
    socket.once("error", onError);
    socket.connect(port, "127.0.0.1");
  });

  const key = crypto.randomBytes(16).toString("base64");
  const request = [
    `GET /ws?session=${encodeURIComponent(sessionToken)} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "\r\n",
  ].join("\r\n");
  socket.write(request);

  const headers = await readUpgradeHeaders(socket);
  return {
    socket,
    isClosed: () => closed,
    statusLine: headers.split("\r\n")[0] ?? "",
  };
}

async function readUpgradeHeaders(socket) {
  let buffer = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("websocket upgrade timed out"));
    }, 3000);
    function onData(chunk) {
      buffer += chunk.toString("binary");
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        cleanup();
        resolve(buffer.slice(0, headerEnd));
      }
    }
    function onError(err) {
      cleanup();
      reject(err);
    }
    function cleanup() {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    }
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function waitForSocketClose(socket, timeoutMs) {
  await Promise.race([
    new Promise((resolve) => socket.once("close", resolve)),
    sleep(timeoutMs).then(() => {
      socket.destroy();
    }),
  ]);
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

function maskedBinaryFrame(payload) {
  if (payload.length > 125) {
    throw new Error("test frame helper only supports small payloads");
  }
  const mask = crypto.randomBytes(4);
  const header = Buffer.from([0x82, 0x80 | payload.length]);
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index] ^ mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
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
