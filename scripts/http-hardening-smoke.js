import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4135);
const bodyLimitBytes = Number(args.bodyLimitBytes ?? 128);
const runtimeDir = path.resolve("var", "http-hardening-smoke");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const httpUrl = `http://127.0.0.1:${port}`;
const startedAt = performance.now();
const forwardedRequestId = "trace-smoke_001.edge";
const unsafeRequestId = "trace smoke with spaces";

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}
if (!Number.isInteger(bodyLimitBytes) || bodyLimitBytes <= 0) {
  throw new Error("--bodyLimitBytes must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;

try {
  server = await startServer();

  const indexResponse = await fetch(`${httpUrl}/`, {
    headers: { "x-request-id": forwardedRequestId },
  });
  await indexResponse.arrayBuffer();
  const assetResponse = await fetch(`${httpUrl}/assets/sprites/player-placeholder.png`);
  await assetResponse.arrayBuffer();
  const sessionOk = await fetch(`${httpUrl}/api/session`, {
    method: "POST",
    headers: { "x-request-id": unsafeRequestId },
  });
  await sessionOk.arrayBuffer();
  const oversizedBody = "x".repeat(bodyLimitBytes + 1);
  const oversized = await fetch(`${httpUrl}/api/session`, {
    method: "POST",
    headers: {
      "content-type": "text/plain",
    },
    body: oversizedBody,
  });
  await oversized.arrayBuffer();
  const summary = await fetch(`${httpUrl}/admin/summary`).then((response) => response.json());
  const metrics = await fetch(`${httpUrl}/metrics`).then((response) => response.text());

  result = {
    port,
    bodyLimitBytes,
    headers: {
      index: selectedHeaders(indexResponse.headers),
      asset: selectedHeaders(assetResponse.headers),
      oversized: selectedHeaders(oversized.headers),
    },
    statuses: {
      index: indexResponse.status,
      asset: assetResponse.status,
      sessionOk: sessionOk.status,
      oversized: oversized.status,
    },
    summary: {
      httpBodyLimitBytes: summary.httpBodyLimitBytes,
    },
    metrics: {
      sundermere_http_body_limit_bytes: parseMetric(
        metrics,
        "sundermere_http_body_limit_bytes",
      ),
    },
    elapsedMs: round(performance.now() - startedAt),
    ok:
      indexResponse.status === 200 &&
      assetResponse.status === 200 &&
      sessionOk.status === 200 &&
      oversized.status === 413 &&
      indexResponse.headers.get("x-content-type-options") === "nosniff" &&
      indexResponse.headers.get("x-request-id") === forwardedRequestId &&
      indexResponse.headers.get("referrer-policy") === "no-referrer" &&
      indexResponse.headers.get("permissions-policy")?.includes("geolocation=()") &&
      indexResponse.headers.get("content-security-policy")?.includes("default-src 'self'") &&
      indexResponse.headers.get("cache-control") === "no-store" &&
      assetResponse.headers.get("cache-control") === "public, max-age=60" &&
      isGeneratedRequestId(assetResponse.headers.get("x-request-id")) &&
      isGeneratedRequestId(sessionOk.headers.get("x-request-id")) &&
      sessionOk.headers.get("x-request-id") !== unsafeRequestId &&
      oversized.headers.get("x-content-type-options") === "nosniff" &&
      isGeneratedRequestId(oversized.headers.get("x-request-id")) &&
      oversized.headers.get("cache-control") === "no-store" &&
      summary.httpBodyLimitBytes === bodyLimitBytes &&
      parseMetric(metrics, "sundermere_http_body_limit_bytes") === bodyLimitBytes,
  };
} finally {
  if (server) {
    await stopServer(server);
  }
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) {
  process.exitCode = 1;
}

async function startServer() {
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${port}`,
      HTTP_BODY_LIMIT_BYTES: String(bodyLimitBytes),
      JOURNAL_PATH: path.join(runtimeDir, `${runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`),
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    logs += String(chunk);
  });

  await waitForHealth(child, logs);
  return child;
}

async function waitForHealth(child, logs) {
  const deadline = performance.now() + 10000;
  const url = `${httpUrl}/healthz`;
  while (performance.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited during startup with code ${child.exitCode}: ${logs}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok && (await response.text()) === "ok") {
        return;
      }
    } catch {
      // Retry until the startup deadline.
    }
    await sleep(120);
  }
  throw new Error(`server did not become healthy on ${url}: ${logs}`);
}

async function stopServer(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGINT");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3000).then(() => {
      if (child.exitCode == null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

function selectedHeaders(headers) {
  return {
    cacheControl: headers.get("cache-control"),
    contentSecurityPolicy: headers.get("content-security-policy"),
    crossOriginResourcePolicy: headers.get("cross-origin-resource-policy"),
    permissionsPolicy: headers.get("permissions-policy"),
    referrerPolicy: headers.get("referrer-policy"),
    xRequestId: headers.get("x-request-id"),
    xContentTypeOptions: headers.get("x-content-type-options"),
  };
}

function isGeneratedRequestId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value ?? "",
  );
}

function parseMetric(text, name) {
  const match = text.match(new RegExp(`^${name} ([0-9]+)$`, "m"));
  return match ? Number(match[1]) : Number.NaN;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
