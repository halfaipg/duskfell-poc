import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

import { cases } from "./deployment-preflight/smoke-cases.js";

const startedAt = performance.now();

const results = [];

for (const testCase of cases) {
  results.push(await runCase(testCase));
}

const result = {
  ok: results.every((entry) => entry.ok),
  elapsedMs: round(performance.now() - startedAt),
  results,
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}

async function runCase(testCase) {
  const started = performance.now();
  const child = spawn("node", ["scripts/deployment-preflight.js", ...testCase.args], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      ...testCase.env,
    },
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

  const exit = await new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // Keep parsed null; the result below reports the raw output.
  }

  const expectedChecksPresent = testCase.expectedChecks.every((name) =>
    parsed?.checks?.some((check) => check.name === name),
  );
  const expectedOkChecksPassed = (testCase.expectedOkChecks ?? []).every((name) =>
    parsed?.checks?.some((check) => check.name === name && check.ok === true),
  );
  const ok =
    parsed != null &&
    parsed.ok === testCase.expectOk &&
    (testCase.expectOk ? exit.code === 0 : exit.code !== 0) &&
    expectedChecksPresent &&
    expectedOkChecksPassed;

  return {
    name: testCase.name,
    ok,
    exit,
    parsedOk: parsed?.ok ?? null,
    expectedChecksPresent,
    expectedOkChecksPassed,
    elapsedMs: round(performance.now() - started),
    stderr: stderr.trim(),
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}
