import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const basePort = Number(args.port ?? 4154);
const runtimeDir = path.resolve("var", "durable-corruption-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

if (!Number.isInteger(basePort) || basePort <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

const cases = [
  {
    name: "journal",
    port: basePort,
    journalText: "{not-json}\n",
    outboxText: "",
    expected: "failed to parse journal line 1",
  },
  {
    name: "settlement-outbox",
    port: basePort + 1,
    journalText: "",
    outboxText: "{not-json}\n",
    expected: "failed to parse settlement outbox line 1",
  },
  {
    name: "settlement-outbox-invalid-job",
    port: basePort + 2,
    journalText: "",
    outboxText: `${JSON.stringify({
      type: "jobQueued",
      job: {
        jobId: "11111111-1111-4111-8111-111111111111",
        playerId: "22222222-2222-4222-8222-222222222222",
        assetId: "",
        reason: "registrar-demo-deed",
      },
    })}\n`,
    expected: "settlement job assetId",
  },
  {
    name: "settlement-outbox-invalid-receipt",
    port: basePort + 3,
    journalText: "",
    outboxText: `${JSON.stringify({
      type: "jobConfirmed",
      receipt: {
        jobId: "33333333-3333-4333-8333-333333333333",
        playerId: "44444444-4444-4444-8444-444444444444",
        assetId: "dryrun-deed-test",
        status: "",
        chainTx: null,
      },
    })}\n`,
    expected: "settlement receipt status",
  },
  {
    name: "journal-oversized-line",
    port: basePort + 4,
    journalText: `${JSON.stringify({ oversized: "journal-line" })}\n`,
    outboxText: "",
    env: {
      MAX_DURABLE_LINE_BYTES: "8",
    },
    expected: "MAX_DURABLE_LINE_BYTES",
  },
  {
    name: "settlement-outbox-oversized-line",
    port: basePort + 5,
    journalText: "",
    outboxText: `${JSON.stringify({ oversized: "outbox-line" })}\n`,
    env: {
      MAX_DURABLE_LINE_BYTES: "8",
    },
    expected: "MAX_DURABLE_LINE_BYTES",
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
  await writeFile(journalPath, testCase.journalText);
  await writeFile(outboxPath, testCase.outboxText);

  const server = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${testCase.port}`,
      JOURNAL_PATH: journalPath,
      SETTLEMENT_OUTBOX_PATH: outboxPath,
      ...(testCase.env ?? {}),
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

  return {
    name: testCase.name,
    port: testCase.port,
    journalPath,
    outboxPath,
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
