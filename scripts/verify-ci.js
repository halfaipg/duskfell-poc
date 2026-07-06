import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const startedAt = performance.now();
const results = [];

await step("rust-fmt", () => run("cargo", ["fmt", "--all", "--", "--check"]));
await step("rust-check", () => run("cargo", ["check", "--workspace", "--locked"]));
await step("rust-tests", () => run("cargo", ["test", "--workspace", "--locked"]));
await step("supply-chain-smoke", () => run("npm", ["run", "verify:supply-chain"]));
await step("client-tests", () => run("npm", ["run", "test:client"]));
await step("sprite-manifest-tests", () => run("npm", ["run", "test:sprites"]));
await step("terrain-atlas-tests", () => run("npm", ["run", "test:terrain"]));
await step("assets-verify", () => run("npm", ["run", "assets:verify"]));
await step("deployment-preflight-smoke", () => run("npm", ["run", "smoke:deployment-preflight"]));
await step("deploy-audit-smoke", () => run("npm", ["run", "smoke:deploy-audit"]));
await step("drain-mode-smoke", () => run("npm", ["run", "smoke:drain-mode"]));
await step("http-hardening-smoke", () => run("npm", ["run", "smoke:http-hardening"]));
await step("ops-snapshot-smoke", () => run("npm", ["run", "smoke:ops-snapshot"]));
await step("runtime-asset-integrity-smoke", () =>
  run("npm", ["run", "smoke:runtime-asset-integrity"]),
);
await step("runtime-provenance-smoke", () => run("npm", ["run", "smoke:runtime-provenance"]));
await step("asset-serving-smoke", () => run("npm", ["run", "smoke:assets"]));
await step("metrics-smoke", () => run("npm", ["run", "smoke:metrics"]));
await step("readiness-smoke", () => run("npm", ["run", "smoke:readiness"]));
await step("git-whitespace-check", () => run("git", ["diff", "--check", "--", "."]));

const ok = results.every((result) => result.ok);
console.log(
  JSON.stringify(
    {
      ok,
      elapsedMs: round(performance.now() - startedAt),
      results,
    },
    null,
    2,
  ),
);

if (!ok) {
  process.exitCode = 1;
}

async function step(name, fn) {
  const stepStartedAt = performance.now();
  process.stdout.write(`\n[verify:ci] ${name}\n`);
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

function round(value) {
  return Math.round(value * 100) / 100;
}
