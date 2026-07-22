import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateWorld } from "../worldgen-v2/world-pipeline.mjs";
import { readRecipe } from "./recipe.mjs";
import { attachMaterialWeights, MATERIAL_WEIGHT_FAMILIES } from "./material-weights.mjs";

test("material families are deterministic, normalized, and retain soft modifiers", () => {
  const recipe = readRecipe(fileURLToPath(new URL("../../worlds/recipes/duskfell-valley.json", import.meta.url)));
  const source = generateWorld(recipe);
  source.fields.trail = source.fields.water.map((row) => row.map(() => 0));
  source.fields.settlement = source.fields.water.map((row) => row.map(() => 0));
  source.fields.trail[20][20] = 1;
  source.fields.settlement[30][30] = 1;
  const first = attachMaterialWeights(source);
  const second = attachMaterialWeights(source);
  assert.deepEqual(first.materialWeights, second.materialWeights);
  assert.deepEqual(first.materialWeights.families, MATERIAL_WEIGHT_FAMILIES);
  for (let y = 0; y < recipe.dimensions.rows; y += 1) for (let x = 0; x < recipe.dimensions.cols; x += 1) {
    const total = MATERIAL_WEIGHT_FAMILIES.reduce((sum, family) => sum + first.materialWeights.weights[family][y][x], 0);
    assert.ok(Math.abs(total - 1) <= 0.000002, `material weights drift at ${x},${y}`);
  }
  assert.ok(first.materialWeights.weights.road[20][20] > 0);
  assert.ok(first.materialWeights.weights.settlement[30][30] > 0);
  assert.ok(first.materialWeights.weights.riverBank.flat().some((value) => value > 0));
  assert.ok(first.materialWeights.weights.scree.flat().some((value) => value > 0));
  assert.ok(first.materialWeights.weights.cliff.flat().some((value) => value > 0));
});
