export function parseLoadConfig(rawArgs) {
  const args = parseArgs(rawArgs);
  const url = args.url ?? "ws://127.0.0.1:4107/ws";
  const clients = Number(args.clients ?? 20);
  const durationMs = Number(args.durationMs ?? args.duration ?? 5000);
  const inputHz = Number(args.inputHz ?? 10);
  const connectTimeoutMs = Number(args.connectTimeoutMs ?? 4000);

  if (!Number.isInteger(clients) || clients <= 0) {
    throw new Error("--clients must be a positive integer");
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("--durationMs must be positive");
  }
  if (!Number.isFinite(inputHz) || inputHz <= 0) {
    throw new Error("--inputHz must be positive");
  }

  return {
    url,
    clients,
    durationMs,
    inputHz,
    connectTimeoutMs,
    skipMetrics: args.skipMetrics === "true",
    metricsUrl: args.metricsUrl ?? defaultMetricsUrl(url),
    metricsToken: args.metricsToken,
    thresholds: {
      minSnapshotsPerClientSecond: readFiniteNumber(
        args.minSnapshotsPerClientSecond,
        5,
        "--minSnapshotsPerClientSecond",
      ),
      maxAverageMessageBytes: readFiniteNumber(
        args.maxAverageMessageBytes,
        65536,
        "--maxAverageMessageBytes",
      ),
      maxJoinP95Ms: readFiniteNumber(args.maxJoinP95Ms, connectTimeoutMs, "--maxJoinP95Ms"),
      maxTickOverruns: readFiniteNumber(args.maxTickOverruns, 0, "--maxTickOverruns"),
      maxSendErrors: readFiniteNumber(args.maxSendErrors, 0, "--maxSendErrors"),
      maxSnapshotPayloadRejects: readFiniteNumber(
        args.maxSnapshotPayloadRejects,
        0,
        "--maxSnapshotPayloadRejects",
      ),
    },
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
    if (inlineValue != null) {
      parsed[key] = inlineValue;
      continue;
    }
    if (rawArgs[index + 1] == null || rawArgs[index + 1].startsWith("--")) {
      parsed[key] = "true";
      continue;
    }
    parsed[key] = rawArgs[index + 1];
    index += 1;
  }
  return parsed;
}

function defaultMetricsUrl(wsUrl) {
  const target = new URL("/metrics", wsUrl);
  target.protocol = wsUrl.startsWith("wss:") ? "https:" : "http:";
  return target.href;
}

function readFiniteNumber(value, fallback, name) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return parsed;
}
