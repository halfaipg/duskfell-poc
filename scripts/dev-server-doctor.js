import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

import { parseServerMessage } from "../client/server-messages.js";

const execFileAsync = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
const baseUrl = new URL(args.url ?? "http://127.0.0.1:4107");
const timeoutMs = Number(args.timeoutMs ?? 5000);
const accountToken = args.accountToken ?? process.env.DEV_ACCOUNT_TOKEN ?? null;

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error("--timeoutMs must be positive");
}

if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
  throw new Error("--url must use http or https");
}

const startedAt = performance.now();
const checks = [];

await checkPort();
await checkText("healthz", "/healthz", "ok");
await checkReady();
await checkRoot();
await checkSummary();
await checkMetrics();
await checkWebSocket();

const result = {
  url: baseUrl.origin,
  ok: checks.every((check) => check.ok),
  elapsedMs: round(performance.now() - startedAt),
  checks,
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}

async function checkPort() {
  if (baseUrl.hostname !== "127.0.0.1" && baseUrl.hostname !== "localhost") {
    checks.push({
      name: "port-listener",
      ok: true,
      detail: "skipped for non-localhost URL",
    });
    return;
  }

  try {
    const { stdout } = await execFileAsync("lsof", [
      "-nP",
      `-iTCP:${baseUrl.port || defaultPort(baseUrl.protocol)}`,
      "-sTCP:LISTEN",
    ]);
    checks.push({
      name: "port-listener",
      ok: stdout.includes("LISTEN"),
      detail: oneLine(stdout),
    });
  } catch (err) {
    checks.push({
      name: "port-listener",
      ok: false,
      detail: err.stdout ? oneLine(err.stdout) : err.message,
    });
  }
}

async function checkText(name, path, expected) {
  try {
    const response = await fetchWithTimeout(path);
    const body = await response.text();
    checks.push({
      name,
      ok: response.ok && body === expected,
      detail: `${response.status} ${body.slice(0, 80)}`,
    });
  } catch (err) {
    checks.push({
      name,
      ok: false,
      detail: err.message,
    });
  }
}

async function checkReady() {
  try {
    const response = await fetchWithTimeout("/readyz", {
      headers: { accept: "application/json" },
    });
    const body = await response.json();
    const failed = body.checks?.filter((check) => check.ok !== true).map((check) => check.name) ?? [];
    checks.push({
      name: "readyz",
      ok: response.ok && body.ready === true && failed.length === 0,
      detail: failed.length === 0 ? `${response.status} ready` : `${response.status} failed: ${failed.join(", ")}`,
    });
  } catch (err) {
    checks.push({
      name: "readyz",
      ok: false,
      detail: err.message,
    });
  }
}

async function checkRoot() {
  try {
    const response = await fetchWithTimeout("/");
    const body = await response.text();
    checks.push({
      name: "root-html",
      ok: response.ok && body.includes("<title>Duskfell PoC</title>") && body.includes("/app.js"),
      detail: `${response.status} ${response.headers.get("content-type") ?? "unknown content-type"}`,
    });
  } catch (err) {
    checks.push({
      name: "root-html",
      ok: false,
      detail: err.message,
    });
  }
}

async function checkSummary() {
  try {
    const response = await fetchWithTimeout("/admin/summary", {
      headers: { accept: "application/json" },
    });
    const body = await response.json();
    checks.push({
      name: "admin-summary",
      ok: response.ok && Number.isInteger(body.tick) && typeof body.players === "number",
      detail: `${response.status} tick=${body.tick ?? "?"} players=${body.players ?? "?"} public=${body.publicDeployment ?? "?"} requireSession=${body.requireSession ?? "?"} requireAccount=${body.requireAccount ?? "?"}`,
    });
  } catch (err) {
    checks.push({
      name: "admin-summary",
      ok: false,
      detail: err.message,
    });
  }
}

async function checkMetrics() {
  try {
    const response = await fetchWithTimeout("/metrics");
    const body = await response.text();
    const required = [
      "sundermere_tick",
      "sundermere_players",
      "sundermere_require_session",
      "sundermere_require_account",
    ];
    const missing = required.filter((metric) => !body.includes(metric));
    checks.push({
      name: "metrics",
      ok: response.ok && missing.length === 0,
      detail: missing.length === 0 ? `${response.status} required metrics present` : `${response.status} missing: ${missing.join(", ")}`,
    });
  } catch (err) {
    checks.push({
      name: "metrics",
      ok: false,
      detail: err.message,
    });
  }
}

async function checkWebSocket() {
  let socket = null;
  try {
    const session = await issueSession();
    const wsUrl = new URL("/ws", baseUrl);
    wsUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.searchParams.set("session", session.sessionToken);

    const welcome = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("websocket timed out before welcome")), timeoutMs);
      socket = new WebSocket(wsUrl);
      socket.addEventListener("message", (event) => {
        let message;
        try {
          message = parseServerMessage(event.data);
        } catch (err) {
          clearTimeout(timeout);
          reject(err);
          return;
        }
        if (message.type === "welcome") {
          clearTimeout(timeout);
          resolve(message);
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("websocket error"));
      });
    });

    checks.push({
      name: "websocket",
      ok: welcome.playerId === session.sessionId && welcome.snapshot.objects.length > 0,
      detail: `player=${welcome.playerId} players=${welcome.snapshot.players.length} objects=${welcome.snapshot.objects.length}`,
    });
  } catch (err) {
    checks.push({
      name: "websocket",
      ok: false,
      detail: err.message,
    });
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.close(1000, "dev-server-doctor-complete");
    }
  }
}

async function issueSession() {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (accountToken) {
    headers.authorization = `Bearer ${accountToken}`;
  }
  const response = await fetchWithTimeout("/api/session", {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`/api/session returned ${response.status}`);
  }
  return response.json();
}

async function fetchWithTimeout(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(new URL(path, baseUrl), {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
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

function defaultPort(protocol) {
  return protocol === "https:" ? "443" : "80";
}

function oneLine(value) {
  return value.trim().replace(/\s+/g, " ").slice(0, 240);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
