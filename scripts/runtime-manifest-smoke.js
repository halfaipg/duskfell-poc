import { spawn } from "node:child_process";
import { readFile, mkdir, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 4129);
const startupTimeoutMs = Number(args.startupTimeoutMs ?? 10000);
const adminToken = args.adminToken ?? `runtime-manifest-${Date.now()}`;
const buildGitSha = args.buildGitSha ?? null;
const expectedGitSha = args.expectedGitSha ?? buildGitSha;
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const runtimeDir = path.resolve("var", "runtime-manifest-smoke");
const journalPath = path.join(runtimeDir, `${runId}-journal.jsonl`);
const outboxPath = path.join(runtimeDir, `${runId}-settlement-outbox.jsonl`);
const httpUrl = `http://127.0.0.1:${port}`;
const startedAt = performance.now();

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("--port must be a positive integer");
}

await mkdir(runtimeDir, { recursive: true });

let server = null;
let result;

try {
  const expected = await expectedManifestState();
  server = await startServer();

  const missingStatus = await fetchStatus("/admin/runtime");
  const wrongStatus = await fetchStatus("/admin/runtime", "wrong-token");
  const runtime = await fetchJson("/admin/runtime", adminToken);
  const summary = await fetchJson("/admin/summary", adminToken);

  const checks = {
    protected: missingStatus === 401 && wrongStatus === 401,
    app:
      runtime.app?.game === "Duskfell" &&
      runtime.app?.chain === "Base" &&
      runtime.app?.ticker === "$DUSK" &&
      runtime.app?.serverCrate === "sundermere-server",
    buildProvenance:
      expectedGitSha == null
        ? runtime.app?.buildGitSha == null || isNonEmptyString(runtime.app.buildGitSha)
        : runtime.app?.buildGitSha === expectedGitSha,
    content:
      runtime.content?.schemaVersion === summary.content?.schemaVersion &&
      runtime.content?.contentHash === summary.content?.contentHash &&
      runtime.content?.objectCount === summary.content?.objectCount,
    spriteManifest:
      runtime.assets?.sprites?.schemaVersion === expected.sprites.schemaVersion &&
      runtime.assets?.sprites?.entryCount === expected.sprites.entryCount &&
      runtime.assets?.sprites?.maxManifestBytes === expected.maxManifestBytes &&
      runtime.assets?.sprites?.maxImageBytes === expected.maxImageBytes &&
      runtime.assets?.sprites?.images?.length === expected.sprites.images.length &&
      runtime.assets?.sprites?.projection?.kind === "military-plan-oblique" &&
      runtime.assets?.sprites?.projection?.tileWidth === 64 &&
      runtime.assets?.sprites?.projection?.tileHeight === 64 &&
      runtime.assets?.sprites?.projection?.tileAspectRatio === 1 &&
      runtime.assets?.sprites?.projection?.axisAngleDegrees === 45 &&
      runtime.assets?.sprites?.projection?.heightAxis === "screen-y",
    terrainManifest:
      runtime.assets?.terrain?.schemaVersion === expected.terrain.schemaVersion &&
      runtime.assets?.terrain?.entryCount === expected.terrain.entryCount &&
      runtime.assets?.terrain?.maxManifestBytes === expected.maxManifestBytes &&
      runtime.assets?.terrain?.maxImageBytes === expected.maxImageBytes &&
      runtime.assets?.terrain?.images?.length === expected.terrain.images.length &&
      runtime.assets?.terrain?.projection?.kind === "military-plan-oblique" &&
      runtime.assets?.terrain?.projection?.tileWidth === 64 &&
      runtime.assets?.terrain?.projection?.tileHeight === 64 &&
      runtime.assets?.terrain?.projection?.tileAspectRatio === 1 &&
      runtime.assets?.terrain?.projection?.axisAngleDegrees === 45 &&
      runtime.assets?.terrain?.projection?.heightAxis === "screen-y",
    terrainAuthority:
      runtime.assets?.terrainAuthority?.schemaVersion === expected.terrainAuthority.schemaVersion &&
      runtime.assets?.terrainAuthority?.kind === "terrain-authority" &&
      runtime.assets?.terrainAuthority?.projection === "military-plan-oblique" &&
      runtime.assets?.terrainAuthority?.profile === expected.terrainAuthority.profile &&
      runtime.assets?.terrainAuthority?.seed === expected.terrainAuthority.seed &&
      runtime.assets?.terrainAuthority?.unitsPerTile === expected.terrainAuthority.unitsPerTile &&
      runtime.assets?.terrainAuthority?.blockerCount === expected.terrainAuthority.blockerCount &&
      runtime.assets?.terrainAuthority?.resourceNodeCount === expected.terrainAuthority.resourceNodeCount &&
      runtime.assets?.terrainAuthority?.decayConsumerCount === expected.terrainAuthority.decayConsumerCount &&
      runtime.assets?.terrainAuthority?.maxManifestBytes === expected.maxManifestBytes,
    imagePins:
      imagePinsMatch(runtime.assets?.sprites?.images, expected.sprites.images) &&
      imagePinsMatch(runtime.assets?.terrain?.images, expected.terrain.images),
    manifestFingerprints:
      /^fnv1a64:[0-9a-f]{16}$/.test(runtime.assets?.sprites?.manifestFingerprint ?? "") &&
      /^fnv1a64:[0-9a-f]{16}$/.test(runtime.assets?.terrain?.manifestFingerprint ?? "") &&
      /^fnv1a64:[0-9a-f]{16}$/.test(runtime.assets?.terrainAuthority?.manifestFingerprint ?? "") &&
      runtime.assets?.sprites?.manifestBytes > 0 &&
      runtime.assets?.terrain?.manifestBytes > 0 &&
      runtime.assets?.terrainAuthority?.manifestBytes > 0,
  };

  result = {
    port,
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

async function expectedManifestState() {
  const spriteManifest = JSON.parse(await readFile("assets/sprites/manifest.json", "utf8"));
  const terrainManifest = JSON.parse(await readFile("assets/terrain/manifest.json", "utf8"));
  const terrainAuthority = JSON.parse(await readFile("assets/terrain/detail-authority.json", "utf8"));
  return {
    maxManifestBytes: 256 * 1024,
    maxImageBytes: 2 * 1024 * 1024,
    sprites: {
      schemaVersion: spriteManifest.schemaVersion,
      entryCount: spriteManifest.sheets.length,
      images: await Promise.all(
        spriteManifest.sheets.map(async (sheet) => ({
          id: sheet.id,
          image: sheet.image,
          sha256: sheet.imageSha256,
          bytes: (await stat(path.join("assets", "sprites", sheet.image))).size,
          approvalState: sheet.approval?.state,
        })),
      ),
    },
    terrain: {
      schemaVersion: terrainManifest.schemaVersion,
      entryCount: terrainManifest.tiles.length,
      images: [
        {
          id: terrainManifest.tileSheet.id,
          image: terrainManifest.tileSheet.image,
          sha256: terrainManifest.tileSheet.sha256,
          bytes: (await stat(path.join("assets", "terrain", terrainManifest.tileSheet.image))).size,
          approvalState: terrainManifest.approval?.state,
        },
      ],
    },
    terrainAuthority: {
      schemaVersion: terrainAuthority.schemaVersion,
      profile: terrainAuthority.profile,
      seed: terrainAuthority.seed,
      unitsPerTile: terrainAuthority.unitsPerTile,
      blockerCount: terrainAuthority.blockers.length,
      resourceNodeCount: terrainAuthority.resourceNodes.length,
      decayConsumerCount: terrainAuthority.decayConsumers.length,
    },
  };
}

function imagePinsMatch(actualImages, expectedImages) {
  if (!Array.isArray(actualImages) || actualImages.length !== expectedImages.length) return false;
  return expectedImages.every((expected) =>
    actualImages.some(
      (actual) =>
        actual.id === expected.id &&
        actual.image === expected.image &&
        actual.sha256 === expected.sha256 &&
        actual.sha256Verified === true &&
        actual.bytes === expected.bytes &&
        actual.approvalState === expected.approvalState,
    ),
  );
}

function summarizeAssetManifest(manifest) {
  return {
    schemaVersion: manifest?.schemaVersion,
    manifestFingerprint: manifest?.manifestFingerprint,
    manifestBytes: manifest?.manifestBytes,
    maxManifestBytes: manifest?.maxManifestBytes,
    maxImageBytes: manifest?.maxImageBytes,
    projection: manifest?.projection,
    entryCount: manifest?.entryCount,
    images: manifest?.images,
  };
}

function summarizeTerrainAuthority(manifest) {
  return {
    schemaVersion: manifest?.schemaVersion,
    manifestFingerprint: manifest?.manifestFingerprint,
    manifestBytes: manifest?.manifestBytes,
    maxManifestBytes: manifest?.maxManifestBytes,
    projection: manifest?.projection,
    profile: manifest?.profile,
    seed: manifest?.seed,
    unitsPerTile: manifest?.unitsPerTile,
    blockerCount: manifest?.blockerCount,
    resourceNodeCount: manifest?.resourceNodeCount,
    decayConsumerCount: manifest?.decayConsumerCount,
  };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

async function startServer() {
  const child = spawn("cargo", ["run", "-p", "sundermere-server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(buildGitSha == null ? {} : { GIT_SHA: buildGitSha }),
      ADMIN_TOKEN: adminToken,
      BIND_ADDR: `127.0.0.1:${port}`,
      JOURNAL_PATH: journalPath,
      SETTLEMENT_OUTBOX_PATH: outboxPath,
      RUST_LOG: "sundermere_server=warn,tower_http=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth(child);
  return child;
}

async function waitForHealth(child) {
  const deadline = performance.now() + startupTimeoutMs;
  while (performance.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited during startup with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${httpUrl}/healthz`);
      if (response.ok && (await response.text()) === "ok") {
        return;
      }
    } catch {
      // Retry until the startup deadline.
    }
    await sleep(120);
  }
  throw new Error(`server did not become healthy on ${httpUrl}`);
}

async function stopServer(child) {
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

async function fetchStatus(endpoint, token) {
  const headers = {};
  if (token) {
    headers["x-admin-token"] = token;
  }
  const response = await fetch(`${httpUrl}${endpoint}`, { headers });
  await response.arrayBuffer();
  return response.status;
}

async function fetchJson(endpoint, token) {
  const headers = {};
  if (token) {
    headers["x-admin-token"] = token;
  }
  const response = await fetch(`${httpUrl}${endpoint}`, { headers });
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.json();
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    parsed[key] = inlineValue ?? rawArgs[index + 1];
    if (inlineValue == null) index += 1;
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
