import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const image = args.image ?? "duskfell-poc:smoke";
const name = args.name ?? `duskfell-smoke-${Date.now()}`;
const port = Number(args.port ?? 4177);
const startedAt = performance.now();
const adminToken = "container-admin-token-00001";
const metricsToken = "container-metrics-token-0001";

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

let result;
try {
  await run("docker", ["build", "-t", image, "."]);
  await run("docker", ["rm", "-f", name], { allowFailure: true });
  const containerId = await runCapture("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-p",
    `127.0.0.1:${port}:4107`,
    "-e",
    "PUBLIC_DEPLOYMENT=true",
    "-e",
    "REQUIRE_SESSION=true",
    "-e",
    "REQUIRE_ACCOUNT=true",
    "-e",
    "ACCOUNT_AUTH_MODE=dev-token",
    "-e",
    "DEV_ACCOUNT_TOKEN=container-account-token-0001",
    "-e",
    `ADMIN_TOKEN=${adminToken}`,
    "-e",
    `METRICS_TOKEN=${metricsToken}`,
    "-e",
    `ALLOWED_ORIGINS=http://127.0.0.1:${port}`,
    image,
  ]);

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);
  const ready = await fetchJson(`${baseUrl}/readyz`);
  const missingAdminStatus = await fetchStatus(`${baseUrl}/admin/runtime`);
  const runtime = await fetchJson(`${baseUrl}/admin/runtime`, {
    headers: { "x-admin-token": adminToken },
  });
  const missingMetricsStatus = await fetchStatus(`${baseUrl}/metrics`);
  const metricsStatus = await fetchStatus(`${baseUrl}/metrics`, {
    headers: { "x-metrics-token": metricsToken },
  });
  const imageUser = await runCapture("docker", [
    "image",
    "inspect",
    image,
    "--format",
    "{{.Config.User}}",
  ]);
  const healthcheck = await runCapture("docker", [
    "image",
    "inspect",
    image,
    "--format",
    "{{json .Config.Healthcheck}}",
  ]);

  result = {
    ok:
      containerId.trim().length > 0 &&
      ready.ready === true &&
      missingAdminStatus === 401 &&
      runtime.app?.game === "Duskfell" &&
      runtime.app?.ticker === "$DUSK" &&
      missingMetricsStatus === 401 &&
      metricsStatus === 200 &&
      imageUser.trim() === "duskfell:duskfell" &&
      healthcheck.includes("/readyz"),
    image,
    name,
    port,
    containerId: containerId.trim(),
    ready: ready.ready,
    missingAdminStatus,
    runtimeApp: runtime.app,
    missingMetricsStatus,
    metricsStatus,
    imageUser: imageUser.trim(),
    hasReadyzHealthcheck: healthcheck.includes("/readyz"),
    elapsedMs: round(performance.now() - startedAt),
  };
} catch (err) {
  result = {
    ok: false,
    image,
    name,
    port,
    elapsedMs: round(performance.now() - startedAt),
    error: err.message,
  };
} finally {
  await run("docker", ["rm", "-f", name], { allowFailure: true });
}

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

async function waitForHealth(baseUrl) {
  const deadline = performance.now() + 20000;
  let lastError = "";
  while (performance.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok && (await response.text()) === "ok") return;
      lastError = `status=${response.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await sleep(250);
  }
  throw new Error(`container did not become healthy: ${lastError}`);
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function fetchStatus(url, init) {
  const response = await fetch(url, init);
  await response.arrayBuffer();
  return response.status;
}

async function run(command, args, { allowFailure = false } = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(String(chunk)));
  child.stderr.on("data", (chunk) => process.stderr.write(String(chunk)));
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed with code ${code}`);
  }
}

async function runCapture(command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with code ${code}: ${stderr || stdout}`);
  }
  return stdout;
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
