import path from "node:path";

export function createOriginAllowlistContext(rawArgs) {
  const args = parseArgs(rawArgs);
  const port = Number(args.port ?? 4122);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("--port must be a positive integer");
  }

  const runtimeDir = path.resolve("var", "origin-allowlist-smoke");
  return {
    port,
    runtimeDir,
    runId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    httpUrl: `http://127.0.0.1:${port}`,
    allowedOrigin: "http://allowed.example",
    wrongOrigin: "http://wrong.example",
  };
}

export function round(value) {
  return Math.round(value * 10) / 10;
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
