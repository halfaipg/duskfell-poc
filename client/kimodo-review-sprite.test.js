import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  KIMODO_REVIEW_SPRITES,
  kimodoReviewMode,
} from "./kimodo-review-sprite.js";
import { createPlayerDrawer } from "./player-draw.js";

test("selects explicit Blender and Kimodo review modes", () => {
  assert.equal(kimodoReviewMode("?character=blender"), "blender");
  assert.equal(kimodoReviewMode("?kimodo=blender"), "blender");
  assert.equal(kimodoReviewMode("?kimodo=generated"), "generated");
  assert.equal(kimodoReviewMode("?kimodo=1"), "run");
  assert.equal(kimodoReviewMode("?kimodo=run"), "run");
  assert.equal(kimodoReviewMode("?kimodo=zombie"), "zombie");
  assert.equal(kimodoReviewMode("?kimodo=0"), null);
  assert.equal(kimodoReviewMode("?world=valley-v2"), null);
});

test("maps complete eight-direction Kimodo sheets without overlap", () => {
  for (const sprite of Object.values(KIMODO_REVIEW_SPRITES)) {
    const directions = Object.values(sprite.directions);
    assert.equal(directions.length, 8);
    assert.deepEqual(
      directions.map(({ startFrame }) => startFrame),
      Array.from({ length: 8 }, (_, row) => row * sprite.columns),
    );
    assert.ok(directions.every(({ frameCount }) => frameCount === sprite.columns));
    assert.equal(sprite.columns * sprite.rows, directions.at(-1).startFrame + sprite.columns);
  }
});

test("the human review keeps breathing and running inside one consistent sheet", () => {
  const sprite = KIMODO_REVIEW_SPRITES.run;
  assert.equal(sprite.columns, 37);
  assert.deepEqual(sprite.anchor, { kind: "foot", x: 64, y: 128 });
  assert.deepEqual(sprite.animation.idleFrames, Array.from({ length: 16 }, (_, index) => index));
  assert.deepEqual(
    sprite.animation.walkFrames,
    Array.from({ length: 21 }, (_, index) => index + 16),
  );
  assert.equal(sprite.animation.frameMs, 700 / 21);
});

test("the generated review preserves independent idle and run timing", () => {
  const sprite = KIMODO_REVIEW_SPRITES.generated;
  assert.equal(sprite.columns, 36);
  assert.deepEqual(sprite.animation.idleFrames, Array.from({ length: 16 }, (_, index) => index));
  assert.deepEqual(
    sprite.animation.walkFrames,
    Array.from({ length: 20 }, (_, index) => index + 16),
  );
  assert.ok(Math.abs(sprite.animation.frameMs - 1000 / 30) < 1e-9);
  assert.equal(sprite.animation.idleFrameMs, 2600 / 16);
});

test("the Blender review uses its camera-derived footprint anchor and authored cadence", () => {
  const sprite = KIMODO_REVIEW_SPRITES.blender;
  assert.equal(sprite.columns, 36);
  assert.deepEqual(sprite.anchor, { kind: "foot", x: 64, y: 110 });
  assert.equal(sprite.render.scale, 0.9);
  assert.equal(sprite.animation.frameMs, 50);
  assert.equal(sprite.animation.idleFrameMs, 2500 / 16);
});

test("the clean human renders pin bald output and corrected plan-oblique yaws", async () => {
  const expectedYaws = [-45, 0, 45, 90, 135, 180, -135, -90];
  for (const candidate of ["human-breathe-clean", "human-run-clean"]) {
    const metadata = JSON.parse(
      await readFile(
        new URL(
          `../assets/sprites/candidates/kimodo/${candidate}/${candidate}-wretch.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.deepEqual(metadata.rootYawDegrees, expectedYaws);
    assert.deepEqual(metadata.hiddenMeshes, ["uo_wretch.cortu_short_messy_hair"]);
    assert.equal(metadata.uprightLocomotion, candidate === "human-run-clean");
  }
});

test("pins browser review images to their Blender provenance hashes", async () => {
  const cases = [
    ["blender", "../blender-locomotion-v2/duskfell-locomotion-v2.json"],
    ["generated", "generated-human-locomotion/generated-human-locomotion-wretch.json"],
    ["run", "human-locomotion-clean/human-locomotion-clean-wretch.json"],
    ["zombie", "zombie-gait-official-fixture/zombie-gait-official-fixture-wretch.json"],
  ];
  for (const [mode, metadataPath] of cases) {
    const metadata = JSON.parse(
      await readFile(new URL(`../assets/sprites/candidates/kimodo/${metadataPath}`, import.meta.url), "utf8"),
    );
    assert.equal(metadata.sheetSha256, KIMODO_REVIEW_SPRITES[mode].imageSha256);
  }
});

test("the in-world review replaces only the local player", () => {
  const ordinary = { id: "ordinary" };
  const review = { id: "review" };
  const drawer = createPlayerDrawer({
    getLocalPlayerId: () => "local",
    getSprites: () => ({ player: ordinary, players: [ordinary], reviewPlayer: review }),
    playerRenderState: { variantIndexFor: () => 0 },
  });

  assert.equal(drawer.playerSpriteFor({ id: "local" }, { moving: true }), review);
  assert.equal(drawer.playerSpriteFor({ id: "local" }, { moving: false }), review);
  assert.equal(drawer.playerSpriteFor({ id: "remote" }), ordinary);
});
