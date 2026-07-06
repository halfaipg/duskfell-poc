import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4147);
const runtimeDir = path.resolve("var", "durable-lock-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const journalPath = path.join(runtimeDir, `${runId}-journal.jsonl`);
const outboxPath = path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

const startedAt = performance.now();
const first = startServer(port);
let second = null;
let result;

try {
  await waitForHealth(first, port);
  second = startServer(port + 1);
  const secondExit = await waitForExit(second, 10000);
  const secondOutput = `${second.stdoutText}\n${second.stderrText}`;
  const mentionedLock = secondOutput.includes("durable lock");
  const mentionedExisting = secondOutput.includes("already exists");

  first.kill("SIGTERM");
  const firstExit = await waitForExit(first, 3000);

  result = {
    ports: {
      first: port,
      second: port + 1,
    },
    journalPath,
    outboxPath,
    firstExit,
    secondExit,
    mentionedLock,
    mentionedExisting,
    elapsedMs: round(performance.now() - startedAt),
    ok:
      secondExit.code !== 0 &&
      mentionedLock &&
      mentionedExisting &&
      (firstExit.code === 0 || firstExit.signal === "SIGTERM"),
  };
} catch (err) {
  if (second && second.exitCode == null) {
    second.kill("SIGKILL");
  }
  if (first.exitCode == null) {
    first.kill("SIGKILL");
  }
  result = {
    ports: {
      first: port,
      second: port + 1,
    },
    elapsedMs: round(performance.now() - startedAt),
    ok: false,
    error: err.message,
    firstOutput: `${first.stdoutText}\n${first.stderrText}`,
    secondOutput: second ? `${second.stdoutText}\n${second.stderrText}` : null,
  };
}

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}

function startServer(bindPort) {
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${bindPort}`,
      JOURNAL_PATH: journalPath,
      SETTLEMENT_OUTBOX_PATH: outboxPath,
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdoutText = "";
  child.stderrText = "";
  child.stdout.on("data", (chunk) => {
    child.stdoutText += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    child.stderrText += String(chunk);
  });
  return child;
}

async function waitForHealth(child, bindPort) {
  const deadline = performance.now() + 10000;
  const httpUrl = `http://127.0.0.1:${bindPort}`;
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
      // Retry until startup deadline.
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
