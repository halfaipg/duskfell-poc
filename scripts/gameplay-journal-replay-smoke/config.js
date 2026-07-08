import path from "node:path";

export function createReplayContext(rawArgs) {
  const args = parseArgs(rawArgs);
  const port = Number(args.port ?? 4124);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("--port must be a positive integer");
  }
  const startupTimeoutMs = Number(args.startupTimeoutMs ?? 10000);
  if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0) {
    throw new Error("--startupTimeoutMs must be positive");
  }
  const craftingTimeoutMs = Number(args.craftingTimeoutMs ?? 60000);
  if (!Number.isFinite(craftingTimeoutMs) || craftingTimeoutMs <= 0) {
    throw new Error("--craftingTimeoutMs must be positive");
  }

  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const runtimeDir = path.resolve("var", "gameplay-journal-replay-smoke");
  return {
    port,
    startupTimeoutMs,
    craftingTimeoutMs,
    runId,
    runtimeDir,
    journalPath: path.join(runtimeDir, `${runId}-journal.jsonl`),
    outboxPath: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
  };
}

export function round(value) {
  return Math.round(value * 100) / 100;
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
