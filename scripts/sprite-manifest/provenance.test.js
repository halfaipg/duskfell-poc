import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { verifySpriteManifest } from "../verify-sprite-manifest.js";
import { makePngHeader, makeTempDir, validManifest, validSheet } from "./test-fixtures.js";

test("rejects unreviewed provenance and UO-derived prompt references", async () => {
  const dir = await makeTempDir();
  await writeFile(path.join(dir, "hero.png"), makePngHeader(384, 128));
  const manifestPath = path.join(dir, "manifest.json");
  const sheet = validSheet();
  sheet.provenance.cleanRoom = false;
  sheet.provenance.prompt = "make this like Ultima Online";
  await writeFile(manifestPath, JSON.stringify(validManifest([sheet]), null, 2));

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
  await writeFile(manifestPath, JSON.stringify(validManifest([sheet]), null, 2));

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
  await writeFile(manifestPath, JSON.stringify(validManifest([sheet]), null, 2));

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
  await writeFile(manifestPath, JSON.stringify(validManifest([sheet]), null, 2));

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
  await writeFile(manifestPath, JSON.stringify(validManifest([sheet]), null, 2));

  const result = await verifySpriteManifest(manifestPath);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /projection drift/);
  assert.match(result.errors.join("\n"), /commercial game\/style/);
});
