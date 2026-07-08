import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { buildRuntimeManifestChecks } from "./runtime-manifest-smoke/checks.js";
import { createRuntimeManifestContext, round } from "./runtime-manifest-smoke/config.js";
import { expectedManifestState } from "./runtime-manifest-smoke/expected.js";
import { fetchJson, fetchStatus } from "./runtime-manifest-smoke/http.js";
import { startServer, stopServer } from "./runtime-manifest-smoke/server.js";
import {
  summarizeAssetManifest,
  summarizeTerrainAuthority,
} from "./runtime-manifest-smoke/summary.js";

const context = createRuntimeManifestContext(process.argv.slice(2));
const startedAt = performance.now();

await mkdir(context.runtimeDir, { recursive: true });

let server = null;
let result;

try {
  const expected = await expectedManifestState();
  server = await startServer(context);

  const missingStatus = await fetchStatus(context, "/admin/runtime");
  const wrongStatus = await fetchStatus(context, "/admin/runtime", "wrong-token");
  const runtime = await fetchJson(context, "/admin/runtime", context.adminToken);
  const summary = await fetchJson(context, "/admin/summary", context.adminToken);

  const checks = buildRuntimeManifestChecks({
    expected,
    expectedGitSha: context.expectedGitSha,
    missingStatus,
    runtime,
    summary,
    wrongStatus,
  });

  result = {
    port: context.port,
    missingStatus,
    wrongStatus,
    checks,
    runtime: {
      app: runtime.app,
      content: runtime.content,
      assets: {
        sprites: summarizeAssetManifest(runtime.assets?.sprites),
        terrain: summarizeAssetManifest(runtime.assets?.terrain),
        terrainAuthority: summarizeTerrainAuthority(runtime.assets?.terrainAuthority),
      },
    },
    elapsedMs: round(performance.now() - startedAt),
    ok: Object.values(checks).every(Boolean),
  };
} finally {
  if (server) {
    await stopServer(server);
  }
}

console.log(JSON.stringify(result, null, 2));

if (!result?.ok) {
  process.exitCode = 1;
}
