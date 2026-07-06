import { spawn } from "node:child_process";
import net from "node:net";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4142);
const runtimeDir = path.resolve("var", "session-token-hardening-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;

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
  const oversizedToken = "x".repeat(129);
  const oversizedUpgrade = await requestWebSocketUpgrade(oversizedToken);
  const afterRejectSummary = await fetchJson("/admin/summary");
  const accepted = await connectWithTicket(session.body.sessionToken, session.body.sessionId);
  const afterAcceptSummary = await fetchJson("/admin/summary");
  const metrics = parseMetrics(await fetchText("/metrics"), [
    "sundermere_players",
    "sundermere_ws_connections_total",
    "sundermere_session_pending_tickets",
    "sundermere_session_tickets_issued_total",
    "sundermere_session_ticket_rejected_total",
  ]);

  result = {
    port,
    sessionStatus: session.status,
    oversizedUpgrade: {
      statusCode: oversizedUpgrade.statusCode,
      statusLine: oversizedUpgrade.statusLine,
      body: oversizedUpgrade.body.trim(),
    },
    afterReject: {
      players: afterRejectSummary.players,
      sessionPendingTickets: afterRejectSummary.sessionPendingTickets,
    },
    accepted,
    afterAccept: {
      players: afterAcceptSummary.players,
      sessionPendingTickets: afterAcceptSummary.sessionPendingTickets,
    },
    metrics,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      session.status === 200 &&
      oversizedUpgrade.statusCode === 401 &&
      oversizedUpgrade.body.includes("invalid session ticket") &&
      afterRejectSummary.players === 0 &&
      afterRejectSummary.sessionPendingTickets === 1 &&
      accepted.welcomeReceived &&
      accepted.identityMatched &&
      afterAcceptSummary.players === 0 &&
      afterAcceptSummary.sessionPendingTickets === 0 &&
      metrics.sundermere_players === 0 &&
      metrics.sundermere_ws_connections_total === 1 &&
      metrics.sundermere_session_pending_tickets === 0 &&
      metrics.sundermere_session_tickets_issued_total === 1 &&
      metrics.sundermere_session_ticket_rejected_total === 1,
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
  const text = await response.text();
  return {
    status: response.status,
    body: parseMaybeJson(text) ?? text,
  };
}

async function requestWebSocketUpgrade(sessionToken) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error("timed out waiting for session-ticket upgrade rejection"));
    }, 5000);
    let response = "";

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      const requestPath = `/ws?session=${encodeURIComponent(sessionToken)}`;
      socket.write(
        [
          `GET ${requestPath} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );
    });
    socket.on("data", (chunk) => {
      response += chunk;
      const parsed = parseCompleteHttpResponse(response);
      if (parsed) {
        settled = true;
        clearTimeout(timeout);
        socket.end();
        resolve(parsed);
      }
    });
    socket.on("end", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(parseHttpResponse(response));
    });
    socket.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function connectWithTicket(sessionToken, sessionId) {
  return new Promise((resolve, reject) => {
    const url = new URL(wsUrl);
    url.searchParams.set("session", sessionToken);
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close(1000, "session-token-hardening-timeout");
      reject(new Error("timed out waiting for welcome"));
    }, 5000);

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type !== "welcome") {
        return;
      }
      clearTimeout(timeout);
      socket.close(1000, "session-token-hardening-complete");
      resolve({
        welcomeReceived: true,
        playerId: message.playerId,
        identityMatched: message.playerId === sessionId,
      });
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("websocket failed before welcome"));
    });
  });
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

function parseHttpResponse(response) {
  const [head, body = ""] = response.split("\r\n\r\n", 2);
  const [statusLine = ""] = head.split("\r\n");
  const statusCode = Number(statusLine.split(" ")[1]);
  return {
    statusLine,
    statusCode,
    body,
  };
}

function parseCompleteHttpResponse(response) {
  const separatorIndex = response.indexOf("\r\n\r\n");
  if (separatorIndex === -1) return null;

  const head = response.slice(0, separatorIndex);
  const body = response.slice(separatorIndex + 4);
  const lines = head.split("\r\n");
  const [statusLine = ""] = lines;
  const contentLengthLine = lines.find((line) =>
    line.toLowerCase().startsWith("content-length:"),
  );
  const contentLength = contentLengthLine
    ? Number(contentLengthLine.slice("content-length:".length).trim())
    : 0;
  if (!Number.isFinite(contentLength) || body.length < contentLength) {
    return null;
  }

  return {
    statusLine,
    statusCode: Number(statusLine.split(" ")[1]),
    body: body.slice(0, contentLength),
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

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
