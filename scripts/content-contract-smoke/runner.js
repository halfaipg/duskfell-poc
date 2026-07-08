import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export async function runCase(context, testCase) {
  const contentPath = path.join(context.runtimeDir, `${context.runId}-${testCase.name}-world.json`);
  await writeFile(contentPath, JSON.stringify(testCase.content, null, 2));

  const server = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BIND_ADDR: `127.0.0.1:${testCase.port}`,
      CONTENT_PATH: contentPath,
      JOURNAL_PATH: path.join(context.runtimeDir, `${context.runId}-${testCase.name}-journal.jsonl`),
      SETTLEMENT_OUTBOX_PATH: path.join(
        context.runtimeDir,
        `${context.runId}-${testCase.name}-settlement-outbox.jsonl`,
      ),
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  server.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  server.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const exit = await waitForExit(server, 10000);
  const output = `${stdout}\n${stderr}`;

  return {
    name: testCase.name,
    port: testCase.port,
    contentPath,
    exit,
    mentionedExpected: output.includes(testCase.expected),
    ok: exit.code !== 0 && output.includes(testCase.expected),
  };
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
