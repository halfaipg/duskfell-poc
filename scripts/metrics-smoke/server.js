import { spawn } from "node:child_process";
import path from "node:path";

export async function startServer(context) {
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${context.port}`,
      JOURNAL_PATH: path.join(context.runtimeDir, `${context.runId}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(
        context.runtimeDir,
        `${context.runId}-settlement-outbox.jsonl`,
      ),
      REQUIRE_SESSION: "true",
      SESSION_TICKET_CAPACITY: "2",
      SESSION_TICKET_TTL_SECONDS: "60",
      MAX_ACTIVE_CONNECTIONS: "7",
      MAX_CONNECTIONS_PER_IP: "7",
      MAX_CONNECTIONS_PER_ACCOUNT: "3",
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth(context, child);
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

async function waitForHealth(context, child) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited during startup with code ${child.exitCode}`);
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
  throw new Error(`server did not become healthy on ${context.httpUrl}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
