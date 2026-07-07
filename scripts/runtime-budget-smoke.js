import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const basePort = Number(args.port ?? 4178);
const runtimeDir = path.resolve("var", "runtime-budget-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

if (!Number.isInteger(basePort) || basePort <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

const cases = [
  {
    name: "peer-cap-exceeds-total-cap",
    port: basePort,
    env: {
      MAX_ACTIVE_CONNECTIONS: "2",
      MAX_CONNECTIONS_PER_IP: "3",
    },
    expected: "MAX_CONNECTIONS_PER_IP must be <= MAX_ACTIVE_CONNECTIONS",
  },
  {
    name: "account-cap-exceeds-total-cap",
    port: basePort + 1,
    env: {
      MAX_ACTIVE_CONNECTIONS: "2",
      MAX_CONNECTIONS_PER_IP: "2",
      MAX_CONNECTIONS_PER_ACCOUNT: "3",
    },
    expected: "MAX_CONNECTIONS_PER_ACCOUNT must be <= MAX_ACTIVE_CONNECTIONS",
  },
  {
    name: "ip-session-burst-exceeds-refill",
    port: basePort + 2,
    env: {
      SESSION_ISSUE_RATE_LIMIT_PER_MINUTE: "10",
      SESSION_ISSUE_RATE_LIMIT_BURST: "11",
    },
    expected: "SESSION_ISSUE_RATE_LIMIT_BURST",
  },
  {
    name: "account-session-burst-exceeds-refill",
    port: basePort + 3,
    env: {
      ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE: "10",
      ACCOUNT_SESSION_RATE_LIMIT_BURST: "11",
    },
    expected: "ACCOUNT_SESSION_RATE_LIMIT_BURST",
  },
  {
    name: "ws-text-cap-too-small",
    port: basePort + 4,
    env: {
      WS_MAX_TEXT_BYTES: "1",
    },
    expected: "WS_MAX_TEXT_BYTES",
  },
  {
    name: "snapshot-cap-too-large",
    port: basePort + 5,
    env: {
      MAX_SNAPSHOT_BYTES: "1048577",
    },
    expected: "MAX_SNAPSHOT_BYTES",
  },
  {
    name: "input-sequence-step-too-large",
    port: basePort + 6,
    env: {
      WS_MAX_INPUT_SEQUENCE_STEP: "100001",
    },
    expected: "WS_MAX_INPUT_SEQUENCE_STEP",
  },
];

const startedAt = performance.now();
const results = [];

for (const testCase of cases) {
  results.push(await runCase(testCase));
}

const result = {
  basePort,
  results,
  elapsedMs: round(performance.now() - startedAt),
  ok: results.every((caseResult) => caseResult.ok),
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}

async function runCase(testCase) {
  const caseId = `${runId}-${testCase.name}`;
  const journalPath = path.join(runtimeDir, `${caseId}-journal.jsonl`);
  const outboxPath = path.join(runtimeDir, `${caseId}-settlement-outbox.jsonl`);
  const server = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${testCase.port}`,
      JOURNAL_PATH: journalPath,
      SETTLEMENT_OUTBOX_PATH: outboxPath,
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
      ...testCase.env,
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

  return {
    name: testCase.name,
    port: testCase.port,
    exit,
    mentionedExpected: output.includes(testCase.expected),
    ok: exit.code !== 0 && output.includes(testCase.expected),
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
