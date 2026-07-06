import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4124);
const startupTimeoutMs = Number(args.startupTimeoutMs ?? 10000);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const runtimeDir = path.resolve("var", "gameplay-journal-replay-smoke");
const journalPath = path.join(runtimeDir, `${runId}-journal.jsonl`);
const outboxPath = path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`);
const httpUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;
const startedAt = performance.now();

try {
  server = await startServer();
  const crafting = await runNode([
    "scripts/crafting-smoke.js",
    "--url",
    wsUrl,
    "--timeoutMs",
    "16000",
  ]);
  const beforeRestart = await waitForGameplayEvents(crafting.playerId);
  await stopServer(server);
  server = null;

  server = await startServer();
  const [afterRestartSummary, replayedEvents] = await Promise.all([
    fetchJson("/admin/summary"),
    fetchJson("/admin/events?limit=50"),
  ]);
  const afterRestart = findGameplayEvents(replayedEvents, crafting.playerId);

  result = {
    port,
    journalPath,
    playerId: crafting.playerId,
    crafted: crafting.crafted,
    beforeRestartSequences: eventSequences(beforeRestart),
    afterRestartJournalEvents: afterRestartSummary.journalEvents,
    afterRestartJournalReplayedTotalEvents: afterRestartSummary.journalReplayedTotalEvents,
    afterRestartJournalLastSequence: afterRestartSummary.journalLastSequence,
    afterRestartSequences: eventSequences(afterRestart),
    elapsedMs: round(performance.now() - startedAt),
    ok: Boolean(
      crafting.identityMatched &&
        crafting.journaled &&
        hasAllGameplayEvents(beforeRestart) &&
        hasAllGameplayEvents(afterRestart) &&
        eventsAreOrdered(afterRestart) &&
        afterRestartSummary.journalReplayedTotalEvents >= 3 &&
        afterRestartSummary.journalLastSequence >= afterRestart.craft.sequence,
    ),
  };
} finally {
  if (server) {
    await stopServer(server);
  }
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) {
  process.exitCode = 1;
}

async function startServer() {
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${port}`,
      REQUIRE_SESSION: "true",
      JOURNAL_PATH: journalPath,
      SETTLEMENT_OUTBOX_PATH: outboxPath,
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    logs += String(chunk);
  });

  await waitForHealth(child, logs);
  return child;
}

async function waitForHealth(child, logs) {
  const deadline = performance.now() + startupTimeoutMs;
  while (performance.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited during startup with code ${child.exitCode}: ${logs}`);
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
  throw new Error(`server did not become healthy on ${httpUrl}: ${logs}`);
}

async function stopServer(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGINT");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3000).then(() => {
      if (child.exitCode == null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

async function runNode(commandArgs) {
  const child = spawn("node", commandArgs, {
    cwd: process.cwd(),
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
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code !== 0) {
    throw new Error(`${commandArgs.join(" ")} failed with code ${code}: ${stderr || stdout}`);
  }
  return parseLastJson(stdout);
}

async function waitForGameplayEvents(playerId) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const events = await fetchJson("/admin/events?limit=50");
    const found = findGameplayEvents(events, playerId);
    if (hasAllGameplayEvents(found) && eventsAreOrdered(found)) {
      return found;
    }
    await sleep(120);
  }
  throw new Error(`gameplay journal events did not appear for ${playerId}`);
}

async function fetchJson(endpoint) {
  const response = await fetch(`${httpUrl}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.json();
}

function findGameplayEvents(events, playerId) {
  return {
    wood: events.find(
      (event) =>
        event.kind?.type === "resourceGathered" &&
        event.kind.playerId === playerId &&
        event.kind.objectId === "north-grove" &&
        event.kind.resource === "wood" &&
        event.kind.amount === 1 &&
        event.kind.total >= 1,
    ),
    ore: events.find(
      (event) =>
        event.kind?.type === "resourceGathered" &&
        event.kind.playerId === playerId &&
        event.kind.objectId === "east-ore" &&
        event.kind.resource === "ore" &&
        event.kind.amount === 1 &&
        event.kind.total >= 1,
    ),
    craft: events.find(
      (event) =>
        event.kind?.type === "itemCrafted" &&
        event.kind.playerId === playerId &&
        event.kind.objectId === "field-forge" &&
        event.kind.itemId === "trail-kit" &&
        event.kind.amount === 1 &&
        event.kind.total >= 1,
    ),
  };
}

function hasAllGameplayEvents(found) {
  return Boolean(found.wood && found.ore && found.craft);
}

function eventsAreOrdered(found) {
  return (
    hasAllGameplayEvents(found) &&
    found.wood.sequence < found.ore.sequence &&
    found.ore.sequence < found.craft.sequence
  );
}

function eventSequences(found) {
  return {
    wood: found.wood?.sequence ?? null,
    ore: found.ore?.sequence ?? null,
    craft: found.craft?.sequence ?? null,
  };
}

function parseLastJson(output) {
  const start = output.lastIndexOf("\n{");
  const raw = (start >= 0 ? output.slice(start + 1) : output).trim();
  return JSON.parse(raw);
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
