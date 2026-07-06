import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4141);
const runtimeDir = path.resolve("var", "production-profile-guard-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const startedAt = performance.now();

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

const exit = await expectStartupFailure({
  DEPLOYMENT_PROFILE: "production",
  PUBLIC_DEPLOYMENT: "true",
  REQUIRE_SESSION: "true",
  REQUIRE_ACCOUNT: "true",
  ACCOUNT_AUTH_MODE: "jwt-hs256",
  ACCOUNT_JWT_HS256_SECRET: "account-jwt-production-profile-smoke",
  ACCOUNT_JWT_ISSUER: "https://identity.example",
  ACCOUNT_JWT_AUDIENCE: "duskfell",
  ADMIN_TOKEN: "admin-production-profile-smoke",
  METRICS_TOKEN: "metrics-production-profile-smoke",
  ALLOWED_ORIGINS: "https://play.example",
  DURABLE_SYNC_WRITES: "true",
  GIT_SHA: "d15c0de",
});

const result = {
  port,
  code: exit.code,
  signal: exit.signal,
  mentionedDeploymentProfile: exit.output.includes("DEPLOYMENT_PROFILE=production"),
  mentionedDurableDatabase: exit.output.includes("durable database/event-store"),
  mentionedSignerIndexer: exit.output.includes("signer/indexer"),
  mentionedCrossProcessState: exit.output.includes("cross-process admission/rate-limit"),
  elapsedMs: round(performance.now() - startedAt),
  ok:
    exit.code !== 0 &&
    exit.output.includes("DEPLOYMENT_PROFILE=production") &&
    exit.output.includes("durable database/event-store") &&
    exit.output.includes("signer/indexer") &&
    exit.output.includes("cross-process admission/rate-limit"),
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}

async function expectStartupFailure(env) {
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      BIND_ADDR: `127.0.0.1:${port}`,
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const exit = await waitForExit(child, 10000);
  return {
    ...exit,
    output: `${stdout}\n${stderr}`,
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
