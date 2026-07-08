import path from "node:path";

export function createAccountSettlementContext(rawArgs) {
  const args = parseArgs(rawArgs);
  const port = Number(args.port ?? 4162);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("--port must be a positive integer");
  }

  const runtimeDir = path.resolve("var", "account-settlement-smoke");
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    port,
    runtimeDir,
    runId,
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    adminToken: `account-settlement-admin-${runId}`,
    secret: `account-settlement-secret-${runId}`,
    issuer: "https://identity.example",
    audience: "duskfell",
    accountSubject: "acct:wallet:0xabc123",
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
