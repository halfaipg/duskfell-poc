import { mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { createAssetsSmokeContext, round } from "./assets-smoke/config.js";
import { inspectSpriteAssets } from "./assets-smoke/sprites.js";
import { startServer, stopServer } from "./assets-smoke/server.js";
import { inspectTerrainAssets } from "./assets-smoke/terrain.js";

const context = createAssetsSmokeContext(process.argv.slice(2));
const startedAt = performance.now();

await mkdir(context.runtimeDir, { recursive: true });

let server = null;
let result;

try {
  server = await startServer(context);
  const spriteAssets = await inspectSpriteAssets(context);
  const terrainAssets = await inspectTerrainAssets(context);

  result = {
    port: context.port,
    ...spriteAssets.report,
    terrain: terrainAssets.report,
    elapsedMs: round(performance.now() - startedAt),
    ok: spriteAssets.ok && terrainAssets.ok,
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
