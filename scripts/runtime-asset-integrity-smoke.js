import { spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4162);
const startupTimeoutMs = Number(args.startupTimeoutMs ?? 10000);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const runtimeDir = path.resolve("var", "runtime-asset-integrity-smoke");
const startedAt = performance.now();

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let result;

try {
  const mismatch = await runScenario({
    name: "sha-mismatch",
    port,
    mutateAssets: async (assetsDir) => {
      const terrainImagePath = path.join(assetsDir, "terrain", "terrain-placeholder.png");
      const originalTerrain = await readFile(terrainImagePath);
      await writeFile(terrainImagePath, Buffer.concat([originalTerrain, Buffer.from([0])]));
    },
    expectedPatterns: [/SHA-256 mismatch|sha256/i, /terrain-placeholder\.png/],
  });
  const oversizedManifest = await runScenario({
    name: "oversized-manifest",
    port: port + 1,
    extraEnv: {
      MAX_RUNTIME_MANIFEST_BYTES: "1024",
    },
    expectedPatterns: [/MAX_RUNTIME_MANIFEST_BYTES/, /manifest\.json/],
  });
  const oversized = await runScenario({
    name: "oversized-asset",
    port: port + 2,
    extraEnv: {
      MAX_RUNTIME_ASSET_BYTES: "3000",
    },
    expectedPatterns: [/MAX_RUNTIME_ASSET_BYTES/, /placeholder\.png/],
  });

  result = {
    basePort: port,
    scenarios: [mismatch, oversizedManifest, oversized],
    elapsedMs: round(performance.now() - startedAt),
    ok: mismatch.ok && oversizedManifest.ok && oversized.ok,
  };
} catch (err) {
  result = {
    basePort: port,
    elapsedMs: round(performance.now() - startedAt),
    ok: false,
    error: err.message,
  };
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) process.exitCode = 1;

async function runScenario({ name, port, mutateAssets, extraEnv = {}, expectedPatterns }) {
  const scenarioRunId = `${runId}-${name}`;
  const assetsDir = path.join(runtimeDir, `${scenarioRunId}-assets`);
  const journalPath = path.join(runtimeDir, `${scenarioRunId}-journal.jsonl`);
  const outboxPath = path.join(runtimeDir, `${scenarioRunId}-settlement-outbox.jsonl`);
  await cp("assets", assetsDir, { recursive: true });
  if (mutateAssets) await mutateAssets(assetsDir);

  let child = null;
  try {
    child = startServer({ port, assetsDir, journalPath, outboxPath, extraEnv });
    const exit = await waitForExitOrUnexpectedHealth(child, port);
    const expectedPatternsMatched = expectedPatterns.every((pattern) => pattern.test(exit.stderr));
    return {
      name,
      port,
      assetsDir,
      exit: {
        code: exit.code,
        signal: exit.signal,
      },
      expectedPatternsMatched,
      ok: exit.code !== 0 && expectedPatternsMatched,
    };
  } finally {
    if (child && child.exitCode == null) {
      child.kill("SIGKILL");
    }
  }
}

function startServer({ port, assetsDir, journalPath, outboxPath, extraEnv }) {
  return spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnv,
      ASSETS_DIR: assetsDir,
      BIND_ADDR: `127.0.0.1:${port}`,
      JOURNAL_PATH: journalPath,
      SETTLEMENT_OUTBOX_PATH: outboxPath,
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForExitOrUnexpectedHealth(child, port) {
  let stdout = "";
  let stderr = "";
  const httpUrl = `http://127.0.0.1:${port}`;
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const deadline = performance.now() + startupTimeoutMs;
  while (performance.now() < deadline) {
    if (child.exitCode != null) {
      return {
        code: child.exitCode,
        signal: child.signalCode,
        stdout,
        stderr,
      };
    }
    try {
      const response = await fetch(`${httpUrl}/healthz`);
      if (response.ok) {
        return {
          code: 0,
          signal: null,
          stdout,
          stderr: `${stderr}\nserver became healthy despite corrupted asset bytes`,
        };
      }
    } catch {
      // Retry until the process exits or the startup deadline expires.
    }
    await sleep(120);
  }

  return {
    code: child.exitCode,
    signal: child.signalCode,
    stdout,
    stderr: `${stderr}\nserver did not exit or become healthy before timeout`,
  };
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
