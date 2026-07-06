import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const basePort = Number(args.port ?? 4145);
const runtimeDir = path.resolve("var", "durable-size-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

if (!Number.isInteger(basePort) || basePort <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

const cases = [
  {
    name: "journal",
    port: basePort,
    envName: "MAX_JOURNAL_BYTES",
    journalBytes: 64,
    outboxBytes: 0,
  },
  {
    name: "settlement-outbox",
    port: basePort + 1,
    envName: "MAX_SETTLEMENT_OUTBOX_BYTES",
    journalBytes: 0,
    outboxBytes: 64,
  },
];

const startedAt = performance.now();
const results = [];

for (const testCase of cases) {
  results.push(await runCase(testCase));
}

const result = {
  results,
  elapsedMs: round(performance.now() - startedAt),
  ok: results.every((entry) => entry.ok),
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}

async function runCase(testCase) {
  const caseId = `${runId}-${testCase.name}`;
  const journalPath = path.join(runtimeDir, `${caseId}-journal.jsonl`);
  const outboxPath = path.join(runtimeDir, `${caseId}-settlement-outbox.jsonl`);

  await writeFile(journalPath, "j".repeat(testCase.journalBytes));
  await writeFile(outboxPath, "o".repeat(testCase.outboxBytes));

  const server = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${testCase.port}`,
      JOURNAL_PATH: journalPath,
      SETTLEMENT_OUTBOX_PATH: outboxPath,
      MAX_JOURNAL_BYTES: "8",
      MAX_SETTLEMENT_OUTBOX_BYTES: "8",
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

  const exit = await waitForExit(server, 10000);
  const output = `${stdout}\n${stderr}`;
  const mentionedEnv = output.includes(testCase.envName);
  const mentionedExceeding = output.includes("exceeding");

  return {
    name: testCase.name,
    port: testCase.port,
    exit,
    mentionedEnv,
    mentionedExceeding,
    ok: exit.code !== 0 && mentionedEnv && mentionedExceeding,
  };
}

async function waitForExit(child, timeoutMs) {
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
