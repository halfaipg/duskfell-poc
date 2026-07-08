import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { createContentContractCases } from "./content-contract-smoke/cases.js";
import { createContentContractContext, round } from "./content-contract-smoke/config.js";
import { runCase } from "./content-contract-smoke/runner.js";

const context = createContentContractContext(process.argv.slice(2));

await mkdir(context.runtimeDir, { recursive: true });

const startedAt = performance.now();
const results = [];

for (const testCase of createContentContractCases(context.basePort)) {
  results.push(await runCase(context, testCase));
}

const result = {
  basePort: context.basePort,
  results,
  elapsedMs: round(performance.now() - startedAt),
  ok: results.every((caseResult) => caseResult.ok),
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
