import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import { performance } from "node:perf_hooks";
import path from "node:path";

const port = Number(process.env.PORT ?? 4169);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const runtimeDir = path.resolve("var", "trace-redaction-smoke");
const sentinelSession = `trace-redaction-session-${runId}`;
await mkdir(runtimeDir, { recursive: true });

const startedAt = performance.now();
let server = null;
let error = null;
let result = null;

try {
  server = await startServer();
  const handshake = await rawWebSocketHandshake(`/ws?session=${encodeURIComponent(sentinelSession)}`);
  await waitForLogs(
    (logs) =>
      logs.includes("tower_http::trace::on_request") &&
      (logs.includes('path="/ws"') || logs.includes("path=/ws")),
  );
  const logs = getLogs();
  await stopServer(server);
  server = null;

  result = {
    port,
    statusLine: handshake.statusLine,
    traceObserved: logs.includes("tower_http::trace::on_request"),
    containsSentinel: logs.includes(sentinelSession),
    containsSessionQuery: logs.includes("session="),
    containsSanitizedPath: logs.includes('path="/ws"') || logs.includes("path=/ws"),
    elapsedMs: round(performance.now() - startedAt),
  };
} catch (err) {
  error = err;
} finally {
  if (server) {
    await stopServer(server);
  }
}

const ok =
  !error &&
  result?.statusLine?.startsWith("HTTP/1.1 401") &&
  result?.traceObserved === true &&
  result?.containsSentinel === false &&
  result?.containsSessionQuery === false &&
  result?.containsSanitizedPath === true;

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
  let logs = "";
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${port}`,
      REQUIRE_SESSION: "true",
      JOURNAL_PATH: journalPath,
      SETTLEMENT_OUTBOX_PATH: outboxPath,
      RUST_LOG: "trace",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    logs += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    logs += String(chunk);
  });
  child.getLogs = () => logs;

  await waitForHealth(child);
  return child;
}

async function waitForHealth(child) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited during startup with code ${child.exitCode}: ${child.getLogs()}`);
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
  throw new Error(`server did not become healthy on port ${port}: ${child.getLogs()}`);
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

async function rawWebSocketHandshake(pathAndQuery) {
  const key = randomBytes(16).toString("base64");
  const request = [
    `GET ${pathAndQuery} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "",
    "",
  ].join("\r\n");

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
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

async function waitForLogs(predicate) {
  const deadline = performance.now() + 2500;
  while (performance.now() < deadline) {
    if (predicate(getLogs())) {
      return;
    }
    await sleep(50);
  }
  throw new Error(`timed out waiting for trace logs: ${getLogs()}`);
}

function getLogs() {
  return server?.getLogs?.() ?? "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
