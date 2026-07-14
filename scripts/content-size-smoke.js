import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4144);
const runtimeDir = path.resolve("var", "content-size-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const contentPath = path.join(runtimeDir, `${runId}-too-large-world.json`);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });
await writeFile(
  contentPath,
  JSON.stringify(
    {
      schemaVersion: "sundermere-world-v1",
      map: {
        width: 1800.0,
        height: 1100.0,
        safeZoneRadius: 260.0,
        terrain: {
          profile: "duskfell-terrain-v1",
          seed: 7341,
          unitsPerTile: 64,
          tileWidth: 64,
          tileHeight: 64,
          heightScale: 20,
          minElevation: -1,
          maxElevation: 4,
          waterLevel: -1,
          maxWalkableStep: 1,
          materials: ["grass", "field", "dirt", "stone", "water", "settlement", "cobble", "rock", "ruin", "shore"],
        },
      },
      spawn: {
        x: 810.0,
        y: 550.0,
      },
      objects: [
        {
          id: "registrar",
          kind: "registrar",
          label: "Title Office",
          x: 900.0,
          y: 520.0,
          radius: 54.0,
        },
        {
          id: "north-grove",
          kind: "grove",
          label: "Ashen Grove",
          x: 430.0,
          y: 315.0,
          radius: 88.0,
        },
      ],
    },
    null,
    2,
  ),
);

const startedAt = performance.now();
const server = spawn("cargo", ["run", "-p", "sundermere-server"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    BIND_ADDR: `127.0.0.1:${port}`,
    CONTENT_PATH: contentPath,
    MAX_CONTENT_OBJECTS: "1",
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
  contentPath,
  exit,
  elapsedMs: round(performance.now() - startedAt),
  mentionedMaxContentObjects: output.includes("MAX_CONTENT_OBJECTS"),
  mentionedObjectCount: output.includes("object count"),
  ok: exit.code !== 0 && output.includes("MAX_CONTENT_OBJECTS") && output.includes("object count"),
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
