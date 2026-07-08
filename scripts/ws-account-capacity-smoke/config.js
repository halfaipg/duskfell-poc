import { createHmac } from "node:crypto";
import path from "node:path";

export function createAccountCapacityContext(rawArgs) {
  const args = parseArgs(rawArgs);
  const port = Number(args.port ?? 4171);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("--port must be a positive integer");
  }

  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const runtimeDir = path.resolve("var", "ws-account-capacity-smoke");
  return {
    port,
    runId,
    runtimeDir,
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    secret: `ws-account-capacity-secret-${runId}`,
    issuer: "https://identity.example",
    audience: "duskfell",
    subject: "acct:wallet:0xcap",
    maxConnectionsPerAccount: 1,
  };
}

export function signJwt(context, payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", context.secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function round(value) {
  return Math.round(value * 100) / 100;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
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
