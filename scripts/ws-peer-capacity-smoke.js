import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4139);
const runtimeDir = path.resolve("var", "ws-peer-capacity-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;
const adminToken = `ws-peer-capacity-${runId}`;
const maxConnectionsPerIp = 1;

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let first = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  first = await connectAndHold();
  const second = await connectAndObserve(1200);
  const [summary, metricsText] = await Promise.all([
    fetchJson("/admin/summary"),
    fetchText("/metrics"),
  ]);
  const metrics = parseMetrics(metricsText, [
    "sundermere_active_connections",
    "sundermere_max_connections_per_ip",
    "sundermere_active_connection_ips",
    "sundermere_ws_peer_capacity_rejected_total",
  ]);

  result = {
    port,
    first: {
      welcomed: first.welcomed,
      playerId: first.playerId,
      identityMatched: first.identityMatched,
    },
    second,
    summary: {
      activeConnections: summary.activeConnections,
      maxConnectionsPerIp: summary.maxConnectionsPerIp,
      activeConnectionIps: summary.activeConnectionIps,
    },
    metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      first.welcomed &&
      first.identityMatched &&
      !second.welcomed &&
      second.closed &&
      summary.activeConnections === 1 &&
      summary.maxConnectionsPerIp === maxConnectionsPerIp &&
      summary.activeConnectionIps === 1 &&
      metrics.sundermere_active_connections === 1 &&
      metrics.sundermere_max_connections_per_ip === maxConnectionsPerIp &&
      metrics.sundermere_active_connection_ips === 1 &&
      metrics.sundermere_ws_peer_capacity_rejected_total === 1,
  };
} finally {
  if (first) {
    first.close();
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
      ADMIN_TOKEN: adminToken,
      REQUIRE_SESSION: "true",
      MAX_ACTIVE_CONNECTIONS: "5",
      MAX_CONNECTIONS_PER_IP: String(maxConnectionsPerIp),
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth(child);
  return child;
}

async function connectAndHold() {
  const session = await issueSession();
  const socketUrl = new URL(wsUrl);
  socketUrl.searchParams.set("session", session.sessionToken);
  const socket = new WebSocket(socketUrl);
  let welcomed = false;
  let playerId = null;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("first websocket welcome timed out")), 5000);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome") {
        welcomed = true;
        playerId = message.playerId;
        clearTimeout(timer);
        resolve();
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("first websocket failed"));
    });
    socket.addEventListener("close", () => {
      if (!welcomed) {
        clearTimeout(timer);
        reject(new Error("first websocket closed before welcome"));
      }
    });
  });

  return {
    welcomed,
    playerId,
    identityMatched: playerId === session.sessionId,
    close: () => {
      try {
        socket.close(1000, "ws-peer-capacity-smoke-complete");
      } catch {
        // Best effort.
      }
    },
  };
}

async function connectAndObserve(durationMs) {
  const session = await issueSession();
  const socketUrl = new URL(wsUrl);
  socketUrl.searchParams.set("session", session.sessionToken);
  const socket = new WebSocket(socketUrl);
  let welcomed = false;
  let closed = false;
  let closeCode = null;

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        socket.close(1000, "ws-peer-capacity-timeout");
      } catch {
        // Best effort.
      }
      resolve();
    }, durationMs);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome") {
        welcomed = true;
      }
    });
    socket.addEventListener("close", (event) => {
      closed = true;
      closeCode = event.code;
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      resolve();
    });
  });

  return {
    sessionId: session.sessionId,
    welcomed,
    closed,
    closeCode,
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
