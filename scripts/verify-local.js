import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const startedAt = performance.now();
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const runtimeDir = path.resolve("var", "verify-local");
await mkdir(runtimeDir, { recursive: true });

const results = [];
let server = null;

try {
  await step("rust-fmt", () => run("cargo", ["fmt", "--all", "--", "--check"]));
  await step("rust-tests", () => run("cargo", ["test", "--workspace"]));
  await step("supply-chain-smoke", () => run("npm", ["run", "verify:supply-chain"]));
  await step("client-tests", () => run("npm", ["run", "test:client"]));
  await step("sprite-manifest-tests", () => run("npm", ["run", "test:sprites"]));
  await step("terrain-atlas-tests", () => run("npm", ["run", "test:terrain"]));
  await step("assets-verify", () => run("npm", ["run", "assets:verify"]));
  await step("deployment-preflight-smoke", () =>
    run("npm", ["run", "smoke:deployment-preflight"]),
  );
  await step("drain-mode-smoke", () => run("npm", ["run", "smoke:drain-mode"]));
  await step("assets-smoke", () => run("npm", ["run", "smoke:assets"]));
  await step("bad-config-smoke", () => run("npm", ["run", "smoke:bad-config"]));
  await step("chain-public-guard-smoke", () =>
    run("npm", ["run", "smoke:chain-public-guard"]),
  );
  await step("chain-local-stub-smoke", () =>
    run("npm", ["run", "smoke:chain-local-stub"]),
  );
  await step("external-bind-guard-smoke", () =>
    run("npm", ["run", "smoke:external-bind-guard"]),
  );
  await step("http-hardening-smoke", () => run("npm", ["run", "smoke:http-hardening"]));
  await step("content-schema-smoke", () => run("npm", ["run", "smoke:content-schema"]));
  await step("content-contract-smoke", () => run("npm", ["run", "smoke:content-contract"]));
  await step("content-size-smoke", () => run("npm", ["run", "smoke:content-size"]));
  await step("durable-size-smoke", () => run("npm", ["run", "smoke:durable-size"]));
  await step("durable-corruption-smoke", () =>
    run("npm", ["run", "smoke:durable-corruption"]),
  );
  await step("durable-sync-smoke", () => run("npm", ["run", "smoke:durable-sync"]));
  await step("account-auth-smoke", () => run("npm", ["run", "smoke:account-auth"]));
  await step("account-jwt-auth-smoke", () => run("npm", ["run", "smoke:account-jwt-auth"]));
  await step("account-session-rate-limit-smoke", () =>
    run("npm", ["run", "smoke:account-session-rate-limit"]),
  );
  await step("account-settlement-smoke", () =>
    run("npm", ["run", "smoke:account-settlement"]),
  );
  await step("admin-auth-smoke", () => run("npm", ["run", "smoke:admin-auth"]));
  await step("admin-events-limit-smoke", () =>
    run("npm", ["run", "smoke:admin-events-limit"]),
  );
  await step("admin-snapshot-size-smoke", () =>
    run("npm", ["run", "smoke:admin-snapshot-size"]),
  );
  await step("metrics-auth-smoke", () => run("npm", ["run", "smoke:metrics-auth"]));
  await step("origin-allowlist-smoke", () => run("npm", ["run", "smoke:origin-allowlist"]));
  await step("public-deployment-smoke", () => run("npm", ["run", "smoke:public-deployment"]));
  await step("metrics-smoke", () => run("npm", ["run", "smoke:metrics"]));
  await step("readiness-smoke", () => run("npm", ["run", "smoke:readiness"]));
  await step("session-capacity-smoke", () => run("npm", ["run", "smoke:session-capacity"]));
  await step("session-expiry-smoke", () => run("npm", ["run", "smoke:session-expiry"]));
  await step("session-expired-ws-smoke", () =>
    run("npm", ["run", "smoke:session-expired-ws"]),
  );
  await step("session-rate-limit-smoke", () =>
    run("npm", ["run", "smoke:session-rate-limit"]),
  );
  await step("interest-radius-smoke", () => run("npm", ["run", "smoke:interest-radius"]));
  await step("movement-authority-smoke", () => run("npm", ["run", "smoke:movement-authority"]));
  await step("rename-validation-smoke", () => run("npm", ["run", "smoke:rename-validation"]));
  await step("snapshot-interval-smoke", () => run("npm", ["run", "smoke:snapshot-interval"]));
  await step("journal-anomaly-smoke", () => run("npm", ["run", "smoke:journal-anomaly"]));
  await step("journal-replay-smoke", () => run("npm", ["run", "smoke:journal-replay"]));
  await step("gameplay-journal-replay-smoke", () =>
    run("npm", ["run", "smoke:gameplay-journal-replay"]),
  );
  await step("settlement-idempotency-smoke", () =>
    run("npm", ["run", "smoke:settlement-idempotency"]),
  );
  await step("restart-reconcile-smoke", () => run("npm", ["run", "smoke:restart-reconcile"]));
  await step("shutdown-smoke", () => run("npm", ["run", "smoke:shutdown"]));
  await step("ws-admission-preflight-smoke", () =>
    run("npm", ["run", "smoke:ws-admission-preflight"]),
  );
  await step("ws-binary-reject-smoke", () => run("npm", ["run", "smoke:ws-binary-reject"]));
  await step("ws-ingress-config-smoke", () =>
    run("npm", ["run", "smoke:ws-ingress-config"]),
  );
  await step("ws-snapshot-size-smoke", () => run("npm", ["run", "smoke:ws-snapshot-size"]));
  await step("ws-payload-metrics-smoke", () => run("npm", ["run", "smoke:ws-payload-metrics"]));
  await step("ws-peer-capacity-smoke", () => run("npm", ["run", "smoke:ws-peer-capacity"]));
  await step("ws-reject-limit-smoke", () => run("npm", ["run", "smoke:ws-reject-limit"]));
  await step("ws-idle-timeout-smoke", () => run("npm", ["run", "smoke:ws-idle-timeout"]));

  server = await startServer({
    port: 4112,
    name: "verify-main",
    env: {
      REQUIRE_SESSION: "true",
    },
  });
  await step("client-protocol-smoke", () =>
    run("node", ["scripts/client-protocol-smoke.js", "--url", "ws://127.0.0.1:4112/ws"]),
  );
  await step("deed-smoke", () =>
    run("node", ["scripts/deed-claim-smoke.js", "--url", "ws://127.0.0.1:4112/ws"]),
  );
  await step("resource-gather-smoke", () =>
    run("node", ["scripts/resource-gather-smoke.js", "--url", "ws://127.0.0.1:4112/ws"]),
  );
  await step("crafting-smoke", () =>
    run("node", ["scripts/crafting-smoke.js", "--url", "ws://127.0.0.1:4112/ws"]),
  );
  await step("ws-load-smoke", () =>
    run("node", [
      "scripts/ws-load-smoke.js",
      "--url",
      "ws://127.0.0.1:4112/ws",
      "--clients",
      "5",
      "--durationMs",
      "1200",
      "--inputHz",
      "4",
      "--minSnapshotsPerClientSecond",
      "8",
      "--maxAverageMessageBytes",
      "4096",
      "--maxJoinP95Ms",
      "1000",
      "--maxTickOverruns",
      "0",
      "--maxSendErrors",
      "0",
      "--maxSnapshotPayloadRejects",
      "0",
    ]),
  );
  await stopServer(server);
  server = null;

  server = await startServer({
    port: 4113,
    name: "verify-capacity",
    env: {
      REQUIRE_SESSION: "true",
      MAX_ACTIVE_CONNECTIONS: "1",
    },
  });
  await step("capacity-smoke", () =>
    run("node", ["scripts/ws-capacity-smoke.js", "ws://127.0.0.1:4113/ws"]),
  );
} finally {
  if (server) {
    await stopServer(server);
  }
}

console.log(
  JSON.stringify(
    {
      ok: results.every((result) => result.ok),
      elapsedMs: round(performance.now() - startedAt),
      results,
    },
    null,
    2,
  ),
);

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}

async function step(name, fn) {
  const stepStartedAt = performance.now();
  process.stdout.write(`\n[verify] ${name}\n`);
  try {
    await fn();
    results.push({
      name,
      ok: true,
      elapsedMs: round(performance.now() - stepStartedAt),
    });
  } catch (err) {
    results.push({
      name,
      ok: false,
      elapsedMs: round(performance.now() - stepStartedAt),
      error: err.message,
    });
    throw err;
  }
}

async function startServer({ port, name, env = {} }) {
  const journalPath = path.join(runtimeDir, `${runId}-${name}-journal.jsonl`);
  const outboxPath = path.join(runtimeDir, `${runId}-${name}-settlement-outbox.jsonl`);
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      BIND_ADDR: `127.0.0.1:${port}`,
      JOURNAL_PATH: journalPath,
      SETTLEMENT_OUTBOX_PATH: outboxPath,
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

  await waitForHealth(child, port, logs);
  return child;
}

async function waitForHealth(child, port, logs) {
  const deadline = performance.now() + 10000;
  const url = `http://127.0.0.1:${port}/healthz`;
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

async function run(command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    stdout += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    stderr += text;
    process.stderr.write(text);
  });
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with code ${code}: ${stderr || stdout}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
