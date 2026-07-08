import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { readPngDimensions, verifySpriteManifest } from "../verify-sprite-manifest.js";
import { makePngHeader, makeTempDir, validSheet } from "./test-fixtures.js";

test("reads PNG dimensions from IHDR", () => {
  const png = makePngHeader(384, 256);
  assert.deepEqual(readPngDimensions(png), { width: 384, height: 256 });
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
