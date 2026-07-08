import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { verifySpriteManifest } from "../verify-sprite-manifest.js";
import { makePngHeader, makeTempDir, sha256Hex, validManifest, validSheet } from "./test-fixtures.js";

test("accepts manifest-declared paperdoll stacks with aligned equipment layers", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "body.png"), makePngHeader(384, 128));
  await writeFile(path.join(dir, "armor.png"), makePngHeader(384, 128));
  const manifestPath = path.join(dir, "manifest.json");
  const body = validSheet();
  body.id = "body-base";
  body.image = "body.png";
  body.imageSha256 = sha256Hex(makePngHeader(384, 128));
  const armor = validSheet();
  armor.id = "armor-overlay";
  armor.image = "armor.png";
  armor.imageSha256 = sha256Hex(makePngHeader(384, 128));
  armor.render.layer = "equipment";
  armor.render.shadow = { kind: "none" };

  await writeFile(
    manifestPath,
    JSON.stringify(
      validManifest([body, armor], {
        paperdolls: [
          {
            id: "paperdoll-wayfarer",
            role: "player",
            label: "Wayfarer",
            baseSheetId: "body-base",
            layers: [{ slot: "armor", sheetId: "armor-overlay" }],
          },
        ],
      }),
      null,
      2,
    ),
  );

  const result = await verifySpriteManifest(manifestPath);
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("rejects paperdoll layers that are missing or misaligned with the base body", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "body.png"), makePngHeader(384, 128));
  await writeFile(path.join(dir, "armor.png"), makePngHeader(384, 128));
  const manifestPath = path.join(dir, "manifest.json");
  const body = validSheet();
  body.id = "body-base";
  body.image = "body.png";
  body.imageSha256 = sha256Hex(makePngHeader(384, 128));
  const armor = validSheet();
  armor.id = "armor-overlay";
  armor.image = "armor.png";
  armor.imageSha256 = sha256Hex(makePngHeader(384, 128));
  armor.anchor.y = 108;
  armor.render.layer = "equipment";
  armor.render.scale = 0.85;
  armor.render.shadow = { kind: "none" };

  await writeFile(
    manifestPath,
    JSON.stringify(
      validManifest([body, armor], {
        paperdolls: [
          {
            id: "paperdoll-wayfarer",
            role: "player",
            baseSheetId: "body-base",
            layers: [
              { slot: "armor", sheetId: "armor-overlay" },
              { slot: "weapon", sheetId: "missing-weapon" },
            ],
          },
        ],
      }),
      null,
      2,
    ),
  );

  const result = await verifySpriteManifest(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /foot anchor/);
  assert.match(result.errors.join("\n"), /render\.scale/);
  assert.match(result.errors.join("\n"), /missing-weapon/);
});
