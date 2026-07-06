import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4129);
const runtimeDir = path.resolve("var", "admin-events-limit-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;
const adminToken = `admin-events-limit-${runId}`;
const adminEventLimitCap = 3;

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  const connections = [];
  for (let index = 0; index < 4; index += 1) {
    connections.push(await connectAndClose());
  }

  const summary = await waitForJournalEvents(6);
  const [hugeLimitEvents, smallLimitEvents, defaultLimitEvents, metricsText] = await Promise.all([
    fetchJson("/admin/events?limit=999"),
    fetchJson("/admin/events?limit=2"),
    fetchJson("/admin/events"),
    fetchText("/metrics"),
  ]);
  const metrics = parseMetrics(metricsText, ["sundermere_admin_event_limit_cap"]);
  const lastHugeSequence = hugeLimitEvents.at(-1)?.sequence ?? null;
  const firstHugeSequence = hugeLimitEvents[0]?.sequence ?? null;
  const cursorEvents = await fetchJson(`/admin/events?after=${firstHugeSequence}&limit=999`);
  const futureCursorEvents = await fetchJson(
    `/admin/events?after=${summary.journalLastSequence}&limit=999`,
  );

  result = {
    port,
    playerIds: connections.map((connection) => connection.playerId),
    identityMatched: connections.every((connection) => connection.identityMatched),
    journalEvents: summary.journalEvents,
    journalLastSequence: summary.journalLastSequence,
    adminEventLimitCap: summary.adminEventLimitCap,
    hugeLimitCount: hugeLimitEvents.length,
    smallLimitCount: smallLimitEvents.length,
    defaultLimitCount: defaultLimitEvents.length,
    hugeLimitSequences: hugeLimitEvents.map((event) => event.sequence),
    cursorSequences: cursorEvents.map((event) => event.sequence),
    futureCursorCount: futureCursorEvents.length,
    metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      connections.every((connection) => connection.identityMatched) &&
      summary.adminEventLimitCap === adminEventLimitCap &&
      metrics.sundermere_admin_event_limit_cap === adminEventLimitCap &&
      hugeLimitEvents.length === adminEventLimitCap &&
      smallLimitEvents.length === 2 &&
      defaultLimitEvents.length === adminEventLimitCap &&
      firstHugeSequence === summary.journalLastSequence - (adminEventLimitCap - 1) &&
      lastHugeSequence === summary.journalLastSequence &&
      cursorEvents.length === adminEventLimitCap - 1 &&
      cursorEvents[0]?.sequence === firstHugeSequence + 1 &&
      cursorEvents.at(-1)?.sequence === summary.journalLastSequence &&
      futureCursorEvents.length === 0,
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
      ADMIN_EVENT_LIMIT_CAP: String(adminEventLimitCap),
      REQUIRE_SESSION: "true",
      JOURNAL_RETAINED_EVENTS: "20",
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
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

async function connectAndClose() {
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
        socket.close(1000, "admin-events-limit-smoke-complete");
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
