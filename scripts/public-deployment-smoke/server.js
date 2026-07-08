import { spawn } from "node:child_process";
import path from "node:path";

export async function startServer(context, env) {
  const child = spawnServer(context, "public-ok", env);
  await waitForHealth(context, child);
  return child;
}

export async function expectStartupFailure(context, env, expectedOutput = ["PUBLIC_DEPLOYMENT"]) {
  const child = spawnServer(context, "public-refused", env);
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
  const mentionedExpectedOutput = expectedOutput.every((needle) => output.includes(needle));
  return {
    code: exit.code,
    signal: exit.signal,
    mentionedPublicDeployment: output.includes("PUBLIC_DEPLOYMENT"),
    mentionedExpectedOutput,
    ok: exit.code !== 0 && mentionedExpectedOutput,
  };
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
  return Promise.race([
    new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
    sleep(timeoutMs).then(() => {
      child.kill("SIGKILL");
      return {
        code: child.exitCode,
        signal: "timeout",
      };
    }),
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
