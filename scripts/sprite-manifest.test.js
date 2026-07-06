import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readPngDimensions, verifySpriteManifest } from "./verify-sprite-manifest.js";

test("reads PNG dimensions from IHDR", () => {
  const png = makePngHeader(384, 256);
  assert.deepEqual(readPngDimensions(png), { width: 384, height: 256 });
});

test("accepts a clean plan-oblique sprite sheet manifest", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "hero.png"), makePngHeader(384, 128));
  const manifestPath = path.join(dir, "manifest.json");
  const sheet = validSheet();
  sheet.provenance.negativePrompt = "not isometric, not 2:1 dimetric, not 64x32 tiles";
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: "sundermere-sprite-manifest-v1",
        projection: {
          kind: "military-plan-oblique",
          tileWidth: 64,
          tileHeight: 64,
          tileAspectRatio: 1,
          axisAngleDegrees: 45,
          heightAxis: "screen-y",
          unitsPerTile: 64,
        },
        sheets: [sheet],
      },
      null,
      2,
    ),
  );

  const result = await verifySpriteManifest(manifestPath);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.sheetCount, 1);
});

test("rejects dimetric projection drift and mismatched sheet dimensions", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "hero.png"), makePngHeader(256, 128));
  const manifestPath = path.join(dir, "manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: "sundermere-sprite-manifest-v1",
        projection: {
          kind: "isometric",
          tileWidth: 64,
          tileHeight: 32,
          tileAspectRatio: 2,
          axisAngleDegrees: 26.565,
          heightAxis: "screen-y",
          unitsPerTile: 64,
        },
        sheets: [validSheet()],
      },
      null,
      2,
    ),
  );

  const result = await verifySpriteManifest(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /projection.kind/);
  assert.match(result.errors.join("\n"), /1:1 diamonds/);
  assert.match(result.errors.join("\n"), /do not match declared grid/);
});

test("rejects missing or mismatched sprite image hashes", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "hero.png"), makePngHeader(384, 128));
  const manifestPath = path.join(dir, "manifest.json");
  const sheet = validSheet();
  sheet.imageSha256 = "0".repeat(64);
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: "sundermere-sprite-manifest-v1",
        projection: {
          kind: "military-plan-oblique",
          tileWidth: 64,
          tileHeight: 64,
          tileAspectRatio: 1,
          axisAngleDegrees: 45,
          heightAxis: "screen-y",
          unitsPerTile: 64,
        },
        sheets: [sheet],
      },
      null,
      2,
    ),
  );

  let result = await verifySpriteManifest(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /imageSha256/);
  assert.match(result.errors.join("\n"), /does not match actual image hash/);

  delete sheet.imageSha256;
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: "sundermere-sprite-manifest-v1",
        projection: {
          kind: "military-plan-oblique",
          tileWidth: 64,
          tileHeight: 64,
          tileAspectRatio: 1,
          axisAngleDegrees: 45,
          heightAxis: "screen-y",
          unitsPerTile: 64,
        },
        sheets: [sheet],
      },
      null,
      2,
    ),
  );

  result = await verifySpriteManifest(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /imageSha256 must be/);
});

test("rejects unreviewed provenance and UO-derived prompt references", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "hero.png"), makePngHeader(384, 128));
  const manifestPath = path.join(dir, "manifest.json");
  const sheet = validSheet();
  sheet.provenance.cleanRoom = false;
  sheet.provenance.prompt = "make this like Ultima Online";
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: "sundermere-sprite-manifest-v1",
        projection: {
          kind: "military-plan-oblique",
          tileWidth: 64,
          tileHeight: 64,
          tileAspectRatio: 1,
          axisAngleDegrees: 45,
          heightAxis: "screen-y",
          unitsPerTile: 64,
        },
        sheets: [sheet],
      },
      null,
      2,
    ),
  );

  const result = await verifySpriteManifest(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /cleanRoom/);
  assert.match(result.errors.join("\n"), /disallowed UO-derived/);
});

test("rejects incomplete non-placeholder generator provenance", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "hero.png"), makePngHeader(384, 128));
  const manifestPath = path.join(dir, "manifest.json");
  const sheet = validSheet();
  sheet.provenance.method = "ai-generated";
  delete sheet.provenance.toolVersion;
  delete sheet.provenance.sourceHash;
  delete sheet.provenance.termsSnapshot;
  delete sheet.provenance.toolReview;
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: "sundermere-sprite-manifest-v1",
        projection: {
          kind: "military-plan-oblique",
          tileWidth: 64,
          tileHeight: 64,
          tileAspectRatio: 1,
          axisAngleDegrees: 45,
          heightAxis: "screen-y",
          unitsPerTile: 64,
        },
        sheets: [sheet],
      },
      null,
      2,
    ),
  );

  const result = await verifySpriteManifest(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /provenance\.toolVersion/);
  assert.match(result.errors.join("\n"), /provenance\.sourceHash/);
  assert.match(result.errors.join("\n"), /provenance\.termsSnapshot/);
  assert.match(result.errors.join("\n"), /provenance\.toolReview/);
  assert.match(result.errors.join("\n"), /provenance\.model/);
  assert.match(result.errors.join("\n"), /provenance\.modelVersion/);
  assert.match(result.errors.join("\n"), /provenance\.seed/);
});

test("rejects unapproved or malformed generator tool reviews", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "hero.png"), makePngHeader(384, 128));
  const manifestPath = path.join(dir, "manifest.json");
  const sheet = validSheet();
  sheet.provenance.toolReview = {
    status: "reference-only",
    reviewedAt: "2026-07-06",
    reviewer: "test",
    sourceUrl: "ftp://example.invalid/tool",
    risk: "",
  };
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: "sundermere-sprite-manifest-v1",
        projection: {
          kind: "military-plan-oblique",
          tileWidth: 64,
          tileHeight: 64,
          tileAspectRatio: 1,
          axisAngleDegrees: 45,
          heightAxis: "screen-y",
          unitsPerTile: 64,
        },
        sheets: [sheet],
      },
      null,
      2,
    ),
  );

  const result = await verifySpriteManifest(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /toolReview\.status/);
  assert.match(result.errors.join("\n"), /toolReview\.risk/);
  assert.match(result.errors.join("\n"), /toolReview\.sourceUrl must be http or https/);
});

test("rejects quarantined sprite generator identities", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "hero.png"), makePngHeader(384, 128));
  const manifestPath = path.join(dir, "manifest.json");
  const sheet = validSheet();
  sheet.provenance.tool = "AntumDeluge/chargen";
  sheet.provenance.toolReview.sourceUrl = "https://github.com/AntumDeluge/chargen";
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: "sundermere-sprite-manifest-v1",
        projection: {
          kind: "military-plan-oblique",
          tileWidth: 64,
          tileHeight: 64,
          tileAspectRatio: 1,
          axisAngleDegrees: 45,
          heightAxis: "screen-y",
          unitsPerTile: 64,
        },
        sheets: [sheet],
      },
      null,
      2,
    ),
  );

  const result = await verifySpriteManifest(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /tool is quarantined/);
  assert.match(result.errors.join("\n"), /third-party base-art provenance risk/);
});

test("rejects ambiguous projection and commercial style prompt references", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "hero.png"), makePngHeader(384, 128));
  const manifestPath = path.join(dir, "manifest.json");
  const sheet = validSheet();
  sheet.provenance.prompt = "isometric 64x32 Zelda-style sandbox adventurer";
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: "sundermere-sprite-manifest-v1",
        projection: {
          kind: "military-plan-oblique",
          tileWidth: 64,
          tileHeight: 64,
          tileAspectRatio: 1,
          axisAngleDegrees: 45,
          heightAxis: "screen-y",
          unitsPerTile: 64,
        },
        sheets: [sheet],
      },
      null,
      2,
    ),
  );

  const result = await verifySpriteManifest(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /projection drift/);
  assert.match(result.errors.join("\n"), /commercial game\/style/);
});

test("rejects missing or invalid render metadata", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "hero.png"), makePngHeader(384, 128));
  const manifestPath = path.join(dir, "manifest.json");
  const sheet = validSheet();
  sheet.render.layer = "background";
  sheet.render.sort = "depth-buffer";
  sheet.render.zBias = 1200;
  sheet.render.shadow.x = 128;
  sheet.render.shadow.opacity = 2;
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: "sundermere-sprite-manifest-v1",
        projection: {
          kind: "military-plan-oblique",
          tileWidth: 64,
          tileHeight: 64,
          tileAspectRatio: 1,
          axisAngleDegrees: 45,
          heightAxis: "screen-y",
          unitsPerTile: 64,
        },
        sheets: [sheet],
      },
      null,
      2,
    ),
  );

  const result = await verifySpriteManifest(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /render\.layer/);
  assert.match(result.errors.join("\n"), /render\.sort/);
  assert.match(result.errors.join("\n"), /render\.zBias/);
  assert.match(result.errors.join("\n"), /render\.shadow x\/y/);
  assert.match(result.errors.join("\n"), /render\.shadow\.opacity/);
});

function validSheet() {
  return {
    id: "hero-walk-placeholder",
    image: "hero.png",
    imageSha256: sha256Hex(makePngHeader(384, 128)),
    frameGrid: {
      cellWidth: 128,
      cellHeight: 128,
      columns: 3,
      rows: 1,
      frameCount: 3,
    },
    anchor: {
      kind: "foot",
      x: 64,
      y: 112,
    },
    footprint: {
      kind: "diamond",
      widthTiles: 1,
      heightTiles: 1,
    },
    render: {
      layer: "actor",
      sort: "footprint-y",
      zBias: 0,
      shadow: {
        kind: "ellipse",
        x: 64,
        y: 116,
        width: 42,
        height: 12,
        opacity: 0.3,
      },
    },
    directions: [
      {
        name: "south",
        startFrame: 0,
        frameCount: 3,
      },
    ],
    provenance: {
      cleanRoom: true,
      source: "temporary-test-fixture",
      createdAt: "2026-07-06",
      license: "test-only",
      reviewer: "test",
      prompt: "original clean-room plan-oblique adventurer",
      method: "hand-authored",
      tool: "test-fixture-writer",
      toolVersion: "1",
      sourceHash: "sha256:test-fixture",
      termsSnapshot: "test-only local fixture",
      toolReview: {
        status: "approved-internal",
        reviewedAt: "2026-07-06",
        reviewer: "test",
        sourceUrl: "https://example.invalid/test-fixture-writer",
        risk: "local deterministic test fixture only",
      },
    },
    approval: {
      state: "review",
    },
  };
}

async function makeTempDir() {
  return mkdir(path.join(os.tmpdir(), `sundermere-sprites-${Date.now()}-${Math.random()}`), {
    recursive: true,
  });
}

function makePngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
