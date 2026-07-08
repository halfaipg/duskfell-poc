import path from "node:path";

export function createContentContractContext(rawArgs) {
  const args = parseArgs(rawArgs);
  const basePort = Number(args.port ?? 4150);
  if (!Number.isInteger(basePort) || basePort <= 0) {
    throw new Error("--port must be a positive integer");
  }

  return {
    basePort,
    runtimeDir: path.resolve("var", "content-contract-smoke"),
    runId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
