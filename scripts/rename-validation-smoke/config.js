import path from "node:path";

export function createRenameValidationContext(rawArgs) {
  const args = parseArgs(rawArgs);
  const port = Number(args.port ?? 4125);
  const timeoutMs = Number(args.timeoutMs ?? 8000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("--port must be a positive integer");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--timeoutMs must be positive");
  }

  const runtimeDir = path.resolve("var", "rename-validation-smoke");
  return {
    port,
    timeoutMs,
    runtimeDir,
    runId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    spawnName: "Launch_7",
    validName: "Scout_7",
    invalidName: "Scout<script>",
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
