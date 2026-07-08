import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import path from "node:path";

export async function startServer(context) {
  const journalPath = path.join(context.runtimeDir, `${context.runId}-journal.jsonl`);
  const outboxPath = path.join(context.runtimeDir, `${context.runId}-settlement-outbox.jsonl`);
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${context.port}`,
      REQUIRE_SESSION: "true",
      MAX_ACTIVE_CONNECTIONS: "1",
      MAX_CONNECTIONS_PER_IP: "1",
      MAX_CONNECTIONS_PER_ACCOUNT: "1",
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

  await waitForHealth(context, child, logs);
  return child;
}

export async function stopServer(child) {
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

async function waitForHealth(context, child, logs) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited during startup with code ${child.exitCode}: ${logs}`);
    }
    try {
      const response = await fetch(`${context.httpUrl}/healthz`);
      if (response.ok && (await response.text()) === "ok") {
        return;
      }
    } catch {
      // Retry until the startup deadline.
    }
    await sleep(120);
  }
  throw new Error(`server did not become healthy on port ${context.port}: ${logs}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
