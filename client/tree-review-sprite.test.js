import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TREE_REVIEW_SPRITES, treeReviewMode } from "./tree-review-sprite.js";

test("selects only the explicit Blender tree-family review mode", () => {
  assert.equal(treeReviewMode("?trees=1"), "blender");
  assert.equal(treeReviewMode("?trees=blender"), "blender");
  assert.equal(treeReviewMode("?trees=0"), null);
  assert.equal(treeReviewMode("?world=valley-v2"), null);
});

test("pins the review sheet to the validated finished candidate", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL(
        "../assets/sprites/candidates/blender-tree-family-v1/finished-candidate-manifest.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const review = TREE_REVIEW_SPRITES.blender;
  assert.equal(manifest.validation.ok, true);
  assert.equal(manifest.artifacts.detailSheet.sha256, review.imageSha256);
  assert.equal(manifest.runtimeMapping.sheet, review.imagePath.split("/").at(-1));
  assert.deepEqual(manifest.cell.anchor, { x: review.anchor.x, y: review.anchor.y });
  assert.equal(review.columns, 31);
  assert.equal(review.frameCount, 31);
});
