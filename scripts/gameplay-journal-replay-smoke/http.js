import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

import { eventsAreOrdered, findGameplayEvents, hasAllGameplayEvents } from "./journal.js";

export async function runCraftingSmoke(context) {
  const child = spawn(
    "node",
    [
      "scripts/crafting-smoke.js",
      "--url",
      context.wsUrl,
      "--timeoutMs",
      String(context.craftingTimeoutMs),
    ],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
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
    throw new Error(`crafting-smoke.js failed with code ${code}: ${stderr || stdout}`);
  }
  return parseLastJson(stdout);
}

export async function waitForGameplayEvents(context, playerId) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const events = await fetchJson(context, "/admin/events?limit=50");
    const found = findGameplayEvents(events, playerId);
    if (hasAllGameplayEvents(found) && eventsAreOrdered(found)) {
      return found;
    }
    await sleep(120);
  }
  throw new Error(`gameplay journal events did not appear for ${playerId}`);
}

export async function fetchJson(context, endpoint) {
  const response = await fetch(`${context.httpUrl}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.json();
}

function parseLastJson(output) {
  const start = output.lastIndexOf("\n{");
  const raw = (start >= 0 ? output.slice(start + 1) : output).trim();
  return JSON.parse(raw);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
