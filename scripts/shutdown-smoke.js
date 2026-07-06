import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4114);
const runtimeDir = path.resolve("var", "shutdown-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

const startedAt = performance.now();
const server = spawn("cargo", ["run", "-p", "sundermere-server"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    BIND_ADDR: `127.0.0.1:${port}`,
    JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
    SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
    RUST_LOG: "sundermere_server=warn,tower_http=warn",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
server.stdout.on("data", (chunk) => {
  stdout += String(chunk);
});
server.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

let result;

try {
  await waitForHealth(server);
  const healthyAtMs = performance.now() - startedAt;
  server.kill("SIGTERM");
  const exit = await waitForExit(server, 3000);
  result = {
    port,
    healthyAtMs: round(healthyAtMs),
    exit,
    elapsedMs: round(performance.now() - startedAt),
    ok: exit.signal === "SIGTERM" || exit.code === 0,
  };
} catch (err) {
  if (server.exitCode == null) {
    server.kill("SIGKILL");
  }
  result = {
    port,
    elapsedMs: round(performance.now() - startedAt),
    ok: false,
    error: err.message,
    stdout,
    stderr,
  };
}

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
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

async function waitForExit(child, timeoutMs) {
  if (child.exitCode != null || child.signalCode != null) {
    return {
      code: child.exitCode,
      signal: child.signalCode,
    };
  }

  return Promise.race([
    new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
    sleep(timeoutMs).then(() => {
      child.kill("SIGKILL");
      return {
        code: child.exitCode,
        signal: "timeout",
      };
    }),
  ]);
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
