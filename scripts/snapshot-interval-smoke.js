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
const port = Number(args.port ?? 4128);
const runtimeDir = path.resolve("var", "snapshot-interval-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;
const snapshotIntervalMs = 200;
const observeMs = 900;

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
  socket.binaryType = "arraybuffer";
  const observed = await observeSnapshots(socket);
  const summary = await fetchJson("/admin/summary");
  const metrics = parseMetrics(await fetchText("/metrics"), [
    "sundermere_snapshot_interval_ms",
    "sundermere_ws_snapshots_sent_total",
  ]);

  result = {
    port,
    sessionStatus: session.status,
    observed,
    summary: {
      snapshotIntervalMs: summary.snapshotIntervalMs,
    },
    metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      session.status === 200 &&
      observed.welcome === true &&
      observed.snapshots >= 2 &&
      observed.snapshots <= 7 &&
      summary.snapshotIntervalMs === snapshotIntervalMs &&
      metrics.sundermere_snapshot_interval_ms === snapshotIntervalMs &&
      metrics.sundermere_ws_snapshots_sent_total >= observed.snapshots,
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
    socket.close(1000, "snapshot-interval-smoke-complete");
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
      SNAPSHOT_INTERVAL_MS: String(snapshotIntervalMs),
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth(child);
  return child;
}

async function observeSnapshots(ws) {
  let welcome = false;
  let snapshots = 0;
  let firstSnapshotAt = null;
  let lastSnapshotAt = null;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearTimeout(startup);
      resolve();
    }, observeMs);
    const startup = setTimeout(() => {
      clearTimeout(timeout);
      reject(new Error("websocket did not open in time"));
    }, 3000);

    ws.addEventListener("open", () => {
      clearTimeout(startup);
    });
    ws.addEventListener("message", (event) => {
      const message = decodeServerFrame(event.data);
      if (message.type === "welcome") {
        welcome = true;
      } else if (message.type === "snapshot") {
        snapshots += 1;
        firstSnapshotAt ??= performance.now();
        lastSnapshotAt = performance.now();
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(startup);
      clearTimeout(timeout);
      reject(new Error("websocket error"));
    });
  });

  return {
    welcome,
    snapshots,
    firstSnapshotAtMs: firstSnapshotAt ? round(firstSnapshotAt - startedAt) : null,
    lastSnapshotAtMs: lastSnapshotAt ? round(lastSnapshotAt - startedAt) : null,
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
