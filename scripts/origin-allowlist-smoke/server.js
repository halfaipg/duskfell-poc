import { spawn } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";

export async function expectStartupFailure(context, name, allowedOrigins, expectedOutput) {
  const child = spawnServer(context, name, {
    ALLOWED_ORIGINS: allowedOrigins,
    REQUIRE_SESSION: "true",
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const exit = await waitForExit(child, 10000);
  const output = `${stdout}\n${stderr}`;
  const mentionedExpectedOutput = output.includes(expectedOutput);
  return {
    code: exit.code,
    signal: exit.signal,
    mentionedExpectedOutput,
    ok: exit.code !== 0 && mentionedExpectedOutput,
  };
}

export async function startServer(context) {
  const child = spawnServer(context, "valid", {
    ALLOWED_ORIGINS: context.allowedOrigin,
    REQUIRE_SESSION: "true",
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

function spawnServer(context, name, env) {
  return spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      BIND_ADDR: `127.0.0.1:${context.port}`,
      JOURNAL_PATH: path.join(context.runtimeDir, `${context.runId}-${name}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(
        context.runtimeDir,
        `${context.runId}-${name}-settlement-outbox.jsonl`,
      ),
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
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

async function waitForExit(child, timeoutMs) {
  if (child.exitCode != null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("server did not exit before startup failure timeout"));
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
