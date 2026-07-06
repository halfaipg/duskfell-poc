import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import { performance } from "node:perf_hooks";
import path from "node:path";

const port = Number(process.env.PORT ?? 4168);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const runtimeDir = path.resolve("var", "ws-admission-preflight-smoke");
await mkdir(runtimeDir, { recursive: true });

const startedAt = performance.now();
let server = null;
let firstSocket = null;
let secondSocket = null;
let error = null;
let result = null;

try {
  server = await startServer();
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  const firstSession = await issueSession();
  firstSocket = await connectAndHold(wsUrl, firstSession.sessionToken);

  const missingWhileFull = await rawWebSocketHandshake(wsUrl);
  const invalidWhileFull = await rawWebSocketHandshake(wsUrl, "not-a-ticket");
  const secondSession = await issueSession();
  const validWhileFull = await rawWebSocketHandshake(wsUrl, secondSession.sessionToken);
  const duringFullMetrics = parseMetrics(await fetchText("/metrics"), [
    "sundermere_active_connections",
    "sundermere_session_pending_tickets",
    "sundermere_session_ticket_rejected_total",
    "sundermere_ws_capacity_rejected_total",
  ]);

  firstSocket.close(1000, "ws-admission-preflight-smoke-release-capacity");
  await waitForMetric("sundermere_active_connections", 0);

  secondSocket = await connectAndHold(wsUrl, secondSession.sessionToken);
  secondSocket.close(1000, "ws-admission-preflight-smoke-complete");
  await waitForMetric("sundermere_active_connections", 0);

  const afterMetrics = parseMetrics(await fetchText("/metrics"), [
    "sundermere_active_connections",
    "sundermere_session_pending_tickets",
    "sundermere_session_ticket_rejected_total",
    "sundermere_ws_capacity_rejected_total",
  ]);

  result = {
    port,
    firstIdentityMatched: firstSocket.playerId === firstSession.sessionId,
    secondIdentityMatched: secondSocket.playerId === secondSession.sessionId,
    statusLines: {
      missingWhileFull: missingWhileFull.statusLine,
      invalidWhileFull: invalidWhileFull.statusLine,
      validWhileFull: validWhileFull.statusLine,
    },
    duringFullMetrics,
    afterMetrics,
    elapsedMs: round(performance.now() - startedAt),
  };
} catch (err) {
  error = err;
} finally {
  if (firstSocket?.readyState === WebSocket.OPEN) {
    firstSocket.close(1000, "ws-admission-preflight-smoke-cleanup");
  }
  if (secondSocket?.readyState === WebSocket.OPEN) {
    secondSocket.close(1000, "ws-admission-preflight-smoke-cleanup");
  }
  if (server) {
    await stopServer(server);
  }
}

const ok =
  !error &&
  result?.firstIdentityMatched === true &&
  result?.secondIdentityMatched === true &&
  result?.statusLines.missingWhileFull?.startsWith("HTTP/1.1 401") &&
  result?.statusLines.invalidWhileFull?.startsWith("HTTP/1.1 401") &&
  result?.statusLines.validWhileFull?.startsWith("HTTP/1.1 503") &&
  result?.duringFullMetrics.sundermere_active_connections === 1 &&
  result?.duringFullMetrics.sundermere_session_pending_tickets === 1 &&
  result?.duringFullMetrics.sundermere_session_ticket_rejected_total === 2 &&
  result?.duringFullMetrics.sundermere_ws_capacity_rejected_total === 1 &&
  result?.afterMetrics.sundermere_active_connections === 0 &&
  result?.afterMetrics.sundermere_session_pending_tickets === 0 &&
  result?.afterMetrics.sundermere_session_ticket_rejected_total === 2 &&
  result?.afterMetrics.sundermere_ws_capacity_rejected_total === 1;

console.log(
  JSON.stringify(
    {
      ok,
      error: error?.message ?? null,
      ...result,
    },
    null,
    2,
  ),
);

if (!ok) {
  process.exitCode = 1;
}

async function startServer() {
  const journalPath = path.join(runtimeDir, `${runId}-journal.jsonl`);
  const outboxPath = path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`);
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${port}`,
      REQUIRE_SESSION: "true",
      MAX_ACTIVE_CONNECTIONS: "1",
      JOURNAL_PATH: journalPath,
      SETTLEMENT_OUTBOX_PATH: outboxPath,
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    logs += String(chunk);
  });

  await waitForHealth(child, logs);
  return child;
}

async function waitForHealth(child, logs) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited during startup with code ${child.exitCode}: ${logs}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok && (await response.text()) === "ok") {
        return;
      }
    } catch {
      // Retry until the startup deadline.
    }
    await sleep(120);
  }
  throw new Error(`server did not become healthy on port ${port}: ${logs}`);
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
  const response = await fetch(`http://127.0.0.1:${port}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`/api/session returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function connectAndHold(rawUrl, sessionToken) {
  const url = new URL(rawUrl);
  url.searchParams.set("session", sessionToken);
  const socket = new WebSocket(url);
  let playerId = null;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("websocket welcome timed out"));
    }, 2500);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome") {
        playerId = message.playerId;
        clearTimeout(timeout);
        resolve();
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("websocket errored before welcome"));
    });
    socket.addEventListener("close", () => {
      if (!playerId) {
        clearTimeout(timeout);
        reject(new Error("websocket closed before welcome"));
      }
    });
  });

  socket.playerId = playerId;
  return socket;
}

async function rawWebSocketHandshake(rawUrl, sessionToken) {
  const url = new URL(rawUrl);
  if (sessionToken) {
    url.searchParams.set("session", sessionToken);
  }
  const key = randomBytes(16).toString("base64");
  const pathAndQuery = `${url.pathname}${url.search}`;
  const request = [
    `GET ${pathAndQuery} HTTP/1.1`,
    `Host: ${url.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "",
    "",
  ].join("\r\n");

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: url.hostname, port: Number(url.port) });
    let data = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("raw websocket handshake timed out"));
    }, 2000);

    socket.on("connect", () => {
      socket.write(request);
    });
    socket.on("data", (chunk) => {
      data += String(chunk);
      if (data.includes("\r\n\r\n")) {
        clearTimeout(timeout);
        socket.destroy();
        resolve({
          statusLine: data.split("\r\n")[0],
          raw: data,
        });
      }
    });
    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    socket.on("close", () => {
      if (!data) {
        clearTimeout(timeout);
        reject(new Error("raw websocket handshake closed without response"));
      }
    });
  });
}

async function waitForMetric(name, expected) {
  const deadline = performance.now() + 2500;
  while (performance.now() < deadline) {
    const metrics = parseMetrics(await fetchText("/metrics"), [name]);
    if (metrics[name] === expected) {
      return;
    }
    await sleep(80);
  }
  throw new Error(`timed out waiting for ${name}=${expected}`);
}

async function fetchText(pathname) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}: ${await response.text()}`);
  }
  return response.text();
}

function parseMetrics(text, names) {
  const metrics = {};
  for (const name of names) {
    const match = text.match(new RegExp(`^${name} ([-0-9.]+)$`, "m"));
    metrics[name] = match ? Number(match[1]) : Number.NaN;
  }
  return metrics;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
