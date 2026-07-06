import crypto from "node:crypto";
import net from "node:net";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4122);
const allowedOrigin = "http://allowed.example";
const wrongOrigin = "http://wrong.example";
const runtimeDir = path.resolve("var", "origin-allowlist-smoke");
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

  const health = await fetchText("/healthz");
  const missingSession = await issueSession();
  const wrongSession = await issueSession(wrongOrigin);
  const allowedSession = await issueSession(allowedOrigin);

  const missingWs = await rawWebSocketHandshake(allowedSession.body.sessionToken);
  const wrongWs = await rawWebSocketHandshake(allowedSession.body.sessionToken, wrongOrigin);
  const allowedWs = await rawWebSocketHandshake(allowedSession.body.sessionToken, allowedOrigin);

  const summary = await fetchJson("/admin/summary");
  const metrics = parseMetrics(await fetchText("/metrics"), [
    "sundermere_origin_allowlist_enabled",
    "sundermere_origin_allowed_origins",
    "sundermere_origin_rejected_total",
  ]);

  result = {
    port,
    health,
    sessionStatuses: {
      missing: missingSession.status,
      wrong: wrongSession.status,
      allowed: allowedSession.status,
    },
    websocketStatusLines: {
      missing: missingWs.statusLine,
      wrong: wrongWs.statusLine,
      allowed: allowedWs.statusLine,
    },
    summary: {
      originAllowlistEnabled: summary.originAllowlistEnabled,
      originAllowedCount: summary.originAllowedCount,
    },
    metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      health === "ok" &&
      missingSession.status === 403 &&
      wrongSession.status === 403 &&
      allowedSession.status === 200 &&
      missingWs.statusLine.includes("403") &&
      wrongWs.statusLine.includes("403") &&
      allowedWs.statusLine.includes("101") &&
      summary.originAllowlistEnabled === true &&
      summary.originAllowedCount === 1 &&
      metrics.sundermere_origin_allowlist_enabled === 1 &&
      metrics.sundermere_origin_allowed_origins === 1 &&
      metrics.sundermere_origin_rejected_total === 4,
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
      ALLOWED_ORIGINS: allowedOrigin,
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

async function issueSession(origin) {
  const headers = { accept: "application/json" };
  if (origin) {
    headers.origin = origin;
  }

  const response = await fetch(`${httpUrl}/api/session`, {
    method: "POST",
    headers,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: parseMaybeJson(text),
    text,
  };
}

async function rawWebSocketHandshake(sessionToken, origin) {
  const socket = new net.Socket();

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
    origin ? `Origin: ${origin}` : null,
    "\r\n",
  ]
    .filter((line) => line !== null)
    .join("\r\n");
  socket.write(request);

  const headers = await readUpgradeHeaders(socket);
  socket.destroy();
  return {
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

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    parsed[arg.slice(2)] = argv[i + 1];
    i += 1;
  }
  return parsed;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
