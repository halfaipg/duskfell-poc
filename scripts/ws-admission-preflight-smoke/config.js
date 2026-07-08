import path from "node:path";

export function createAdmissionPreflightContext() {
  const port = Number(process.env.PORT ?? 4168);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a positive integer");
  }

  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    port,
    runId,
    runtimeDir: path.resolve("var", "ws-admission-preflight-smoke"),
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
  };
}

export function round(value) {
  return Math.round(value * 100) / 100;
}
