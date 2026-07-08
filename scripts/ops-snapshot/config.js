export function parseSnapshotConfig(rawArgs, env = process.env) {
  const args = parseArgs(rawArgs);
  const baseUrl = new URL(args.url ?? "http://127.0.0.1:4107");
  const timeoutMs = Number(args.timeoutMs ?? 5000);
  const eventLimit = Number(args.eventLimit ?? 50);

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--timeoutMs must be positive");
  }
  if (!Number.isInteger(eventLimit) || eventLimit < 0 || eventLimit > 200) {
    throw new Error("--eventLimit must be an integer between 0 and 200");
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("--url must use http or https");
  }

  return {
    baseUrl,
    timeoutMs,
    eventLimit,
    adminToken: args.adminToken ?? env.ADMIN_TOKEN ?? null,
    metricsToken: args.metricsToken ?? env.METRICS_TOKEN ?? null,
    outPath: args.out ?? null,
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
