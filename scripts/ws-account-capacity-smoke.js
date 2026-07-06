import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4171);
const runtimeDir = path.resolve("var", "ws-account-capacity-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;
const secret = `ws-account-capacity-secret-${runId}`;
const issuer = "https://identity.example";
const audience = "duskfell";
const subject = "acct:wallet:0xcap";
const maxConnectionsPerAccount = 1;

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
  const jwt = signJwt({
    sub: subject,
    iss: issuer,
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 120,
  });
  first = await connectAndHold(jwt);
  const second = await connectAndObserve(jwt, 1200);
  const [summary, metricsText] = await Promise.all([
    fetchJson("/admin/summary"),
    fetchText("/metrics"),
  ]);
  const metrics = parseMetrics(metricsText, [
    "sundermere_active_connections",
    "sundermere_max_connections_per_account",
    "sundermere_active_connection_accounts",
    "sundermere_ws_account_capacity_rejected_total",
    "sundermere_session_pending_tickets",
    "sundermere_session_ticket_rejected_total",
  ]);

  result = {
    port,
    first: {
      welcomed: first.welcomed,
      playerId: first.playerId,
      identityMatched: first.identityMatched,
      accountSubject: first.accountSubject,
    },
    second,
    summary: {
      activeConnections: summary.activeConnections,
      maxConnectionsPerAccount: summary.maxConnectionsPerAccount,
      activeConnectionAccounts: summary.activeConnectionAccounts,
      sessionPendingTickets: summary.sessionPendingTickets,
    },
    metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      first.welcomed &&
      first.identityMatched &&
      first.accountSubject === subject &&
      second.statusLine.startsWith("HTTP/1.1 503") &&
      second.body.includes("server account connection capacity reached") &&
      second.rejectedBeforeUpgrade &&
      summary.activeConnections === 1 &&
      summary.maxConnectionsPerAccount === maxConnectionsPerAccount &&
      summary.activeConnectionAccounts === 1 &&
      summary.sessionPendingTickets === 1 &&
      metrics.sundermere_active_connections === 1 &&
      metrics.sundermere_max_connections_per_account === maxConnectionsPerAccount &&
      metrics.sundermere_active_connection_accounts === 1 &&
      metrics.sundermere_ws_account_capacity_rejected_total === 1 &&
      metrics.sundermere_session_pending_tickets === 1 &&
      metrics.sundermere_session_ticket_rejected_total === 0,
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
      REQUIRE_SESSION: "true",
      REQUIRE_ACCOUNT: "true",
      ACCOUNT_AUTH_MODE: "jwt-hs256",
      ACCOUNT_JWT_HS256_SECRET: secret,
      ACCOUNT_JWT_ISSUER: issuer,
      ACCOUNT_JWT_AUDIENCE: audience,
      MAX_ACTIVE_CONNECTIONS: "5",
      MAX_CONNECTIONS_PER_IP: "5",
      MAX_CONNECTIONS_PER_ACCOUNT: String(maxConnectionsPerAccount),
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth(child);
  return child;
}

async function connectAndHold(jwt) {
  const session = await issueSession(jwt);
  const socketUrl = new URL(wsUrl);
  socketUrl.searchParams.set("session", session.sessionToken);
  const socket = new WebSocket(socketUrl);
  let welcomed = false;
  let playerId = null;
  let accountSubject = null;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("first websocket welcome timed out")), 5000);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome") {
        welcomed = true;
        playerId = message.playerId;
        accountSubject =
          message.snapshot?.players?.find((player) => player.id === message.playerId)
            ?.accountSubject ?? null;
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
    accountSubject,
    identityMatched: playerId === session.sessionId,
    close: () => {
      try {
        socket.close(1000, "ws-account-capacity-smoke-complete");
      } catch {
        // Best effort.
      }
    },
  };
}

async function connectAndObserve(jwt, durationMs) {
  const session = await issueSession(jwt);
  const handshake = await rawWebSocketHandshake(session.sessionToken, durationMs);

  return {
    sessionId: session.sessionId,
    statusLine: handshake.statusLine,
    body: handshake.body.trim(),
    rejectedBeforeUpgrade: !handshake.statusLine.includes("101 Switching Protocols"),
  };
}

async function rawWebSocketHandshake(sessionToken, timeoutMs) {
  const socketUrl = new URL(wsUrl);
  socketUrl.searchParams.set("session", sessionToken);
  const key = randomBytes(16).toString("base64");
  const request = [
    `GET ${socketUrl.pathname}${socketUrl.search} HTTP/1.1`,
    `Host: ${socketUrl.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "",
    "",
  ].join("\r\n");

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: socketUrl.hostname, port });
    let data = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("second websocket handshake timed out"));
    }, timeoutMs);

    socket.on("connect", () => {
      socket.write(request);
    });
    socket.on("data", (chunk) => {
      data += String(chunk);
      if (data.includes("\r\n\r\n")) {
        clearTimeout(timer);
        socket.destroy();
        resolve(parseHttpResponse(data));
      }
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on("close", () => {
      if (!data) {
        clearTimeout(timer);
        reject(new Error("second websocket handshake closed without response"));
      }
    });
  });
}

async function issueSession(jwt) {
  const response = await fetch(`${httpUrl}/api/session`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${jwt}`,
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
  const response = await fetch(`${httpUrl}${endpoint}`);
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

function signJwt(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function parseHttpResponse(response) {
  const [head, body = ""] = response.split("\r\n\r\n", 2);
  const [statusLine = ""] = head.split("\r\n");
  return {
    statusLine,
    statusCode: Number(statusLine.split(" ")[1]),
    body,
  };
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
