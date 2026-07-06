import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const basePort = Number(args.port ?? 4150);
const runtimeDir = path.resolve("var", "content-contract-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

if (!Number.isInteger(basePort) || basePort <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

const cases = [
  {
    name: "missing-registrar",
    port: basePort,
    content: {
      ...validWorld(),
      objects: [
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
    expected: "object id 'registrar'",
  },
  {
    name: "wrong-registrar-kind",
    port: basePort + 1,
    content: {
      ...validWorld(),
      objects: [
        {
          id: "registrar",
          kind: "grove",
          label: "Title Office",
          x: 900.0,
          y: 520.0,
          radius: 54.0,
        },
      ],
    },
    expected: "kind 'registrar'",
  },
  {
    name: "oversized-safe-zone",
    port: basePort + 2,
    content: {
      ...validWorld(),
      map: {
        width: 1800.0,
        height: 1100.0,
        safeZoneRadius: 700.0,
      },
    },
    expected: "safeZoneRadius",
  },
  {
    name: "missing-forge",
    port: basePort + 3,
    content: {
      ...validWorld(),
      objects: [
        {
          id: "registrar",
          kind: "registrar",
          label: "Title Office",
          x: 900.0,
          y: 520.0,
          radius: 54.0,
        },
      ],
    },
    expected: "object id 'field-forge'",
  },
  {
    name: "wrong-forge-kind",
    port: basePort + 4,
    content: {
      ...validWorld(),
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
          id: "field-forge",
          kind: "ore",
          label: "Field Forge",
          x: 1110.0,
          y: 615.0,
          radius: 56.0,
        },
      ],
    },
    expected: "kind 'forge'",
  },
  {
    name: "object-footprint-out-of-bounds",
    port: basePort + 5,
    content: {
      ...validWorld(),
      objects: [
        {
          id: "registrar",
          kind: "registrar",
          label: "Title Office",
          x: 20.0,
          y: 520.0,
          radius: 54.0,
        },
        {
          id: "field-forge",
          kind: "forge",
          label: "Field Forge",
          x: 1110.0,
          y: 615.0,
          radius: 56.0,
        },
      ],
    },
    expected: "footprint radius",
  },
  {
    name: "missing-terrain-profile",
    port: basePort + 6,
    content: {
      ...validWorld(),
      map: {
        width: 1800.0,
        height: 1100.0,
        safeZoneRadius: 260.0,
      },
    },
    expected: "map.terrain",
  },
  {
    name: "terrain-projection-drift",
    port: basePort + 7,
    content: {
      ...validWorld(),
      map: {
        ...validWorld().map,
        terrain: {
          ...validTerrain(),
          tileHeight: 32,
        },
      },
    },
    expected: "tile dimensions",
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
  const contentPath = path.join(runtimeDir, `${runId}-${testCase.name}-world.json`);
  await writeFile(contentPath, JSON.stringify(testCase.content, null, 2));

  const server = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${testCase.port}`,
      CONTENT_PATH: contentPath,
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-${testCase.name}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(
        runtimeDir,
        `${runId}-${testCase.name}-settlement-outbox.jsonl`,
      ),
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
    contentPath,
    exit,
    mentionedExpected: output.includes(testCase.expected),
    ok: exit.code !== 0 && output.includes(testCase.expected),
  };
}

function validWorld() {
  return {
    schemaVersion: "sundermere-world-v1",
    map: {
      width: 1800.0,
      height: 1100.0,
      safeZoneRadius: 260.0,
      terrain: validTerrain(),
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
        id: "field-forge",
        kind: "forge",
        label: "Field Forge",
        x: 1110.0,
        y: 615.0,
        radius: 56.0,
      },
    ],
  };
}

function validTerrain() {
  return {
    profile: "duskfell-terrain-v1",
    seed: 7341,
    unitsPerTile: 64,
    tileWidth: 64,
    tileHeight: 64,
    heightScale: 6,
    minElevation: -1,
    maxElevation: 4,
    waterLevel: -1,
    maxWalkableStep: 1,
    materials: ["grass", "field", "dirt", "stone", "water", "settlement"],
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
