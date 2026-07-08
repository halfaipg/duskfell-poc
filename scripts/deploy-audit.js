import { performance } from "node:perf_hooks";

import { parseAuditConfig, round } from "./deploy-audit/config.js";
import { checkMetrics } from "./deploy-audit/metrics-checks.js";
import { checkMetricsPosture, checkRuntimePosture } from "./deploy-audit/posture-checks.js";
import { checkExpectedGitSha, checkReady, checkRuntime, checkSummary, checkText } from "./deploy-audit/runtime-checks.js";

const config = parseAuditConfig(process.argv.slice(2));
const startedAt = performance.now();
const checks = [];
const context = {
  ...config,
  checks,
  add(name, ok, detail) {
    checks.push({ name, ok, detail });
  },
};

context.expectedGitShaValid = checkExpectedGitSha(context);

await checkText(context, "healthz", "/healthz", "ok");
const ready = await checkReady(context);
const runtime = await checkRuntime(context);
const summary = await checkSummary(context);
const metrics = await checkMetrics(context);
checkRuntimePosture(context, runtime, summary);
checkMetricsPosture(context, metrics);

const result = {
  url: context.baseUrl.origin,
  profile: context.profile,
  ok: checks.every((check) => check.ok),
  elapsedMs: round(performance.now() - startedAt),
  checks,
  runtime: runtime
    ? {
        app: runtime.app,
        content: runtime.content,
      }
    : null,
  ready: ready ? { ready: ready.ready, checks: ready.checks?.length ?? 0 } : null,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
