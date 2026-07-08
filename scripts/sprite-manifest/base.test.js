import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { verifySpriteManifest } from "../verify-sprite-manifest.js";
import { makePngHeader, makeTempDir, validSheet } from "./test-fixtures.js";

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
