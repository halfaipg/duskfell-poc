import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

export async function startServer(context) {
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${context.port}`,
      REQUIRE_SESSION: "true",
      JOURNAL_PATH: context.journalPath,
      SETTLEMENT_OUTBOX_PATH: context.outboxPath,
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs = { value: "" };
  child.stdout.on("data", (chunk) => {
    logs.value += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    logs.value += String(chunk);
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
  const deadline = performance.now() + context.startupTimeoutMs;
  while (performance.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited during startup with code ${child.exitCode}: ${logs.value}`);
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
  throw new Error(`server did not become healthy on ${context.httpUrl}: ${logs.value}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
