import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4132);
const runtimeDir = path.resolve("var", "external-bind-guard-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const bindAddr = args.bindAddr ?? `0.0.0.0:${port}`;

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

const startedAt = performance.now();
const server = spawn("cargo", ["run", "-p", "sundermere-server"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    BIND_ADDR: bindAddr,
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

const exit = await waitForExit(server, 10000);
const output = `${stdout}\n${stderr}`;
const result = {
  port,
  bindAddr,
  exit,
  elapsedMs: round(performance.now() - startedAt),
  mentionedBindAddr: output.includes("BIND_ADDR"),
  mentionedPublicDeployment: output.includes("PUBLIC_DEPLOYMENT=true"),
  ok: exit.code !== 0 && output.includes("BIND_ADDR") && output.includes("PUBLIC_DEPLOYMENT=true"),
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
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
