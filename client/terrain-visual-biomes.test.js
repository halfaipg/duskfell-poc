import assert from "node:assert/strict";
import test from "node:test";

import {
  VISUAL_BIOMES,
  activeVisualBiomesForPatch,
  dominantVisualBiomesAt,
  visualBiomeWeightsAt,
} from "./terrain-visual-biomes.js";

test("visual biome weights are deterministic, bounded, and normalized", () => {
  const first = visualBiomeWeightsAt(17.25, 9.5, 52, 34, 7341);
  const second = visualBiomeWeightsAt(17.25, 9.5, 52, 34, 7341);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first), VISUAL_BIOMES);
  assert.ok(Object.values(first).every((weight) => weight >= 0 && weight <= 1));
  assert.ok(Math.abs(Object.values(first).reduce((sum, weight) => sum + weight, 0) - 1) < 0.000001);
});

test("visible patch blending stays bounded to four relevant biome layers", () => {
  for (let superY = 0; superY < 4; superY += 1) {
    for (let superX = 0; superX < 6; superX += 1) {
      const active = activeVisualBiomesForPatch(superX, superY, 16, 96, 64, 7341);
      assert.ok(active.length >= 1 && active.length <= 4);
      assert.ok(active.every((biome) => VISUAL_BIOMES.includes(biome)));
    }
  }
});

test("the designed world is a two-region layout: meadow heartland, heath crescent", () => {
  const dominant = new Set();
  for (let y = 0; y <= 34; y += 1) {
    for (let x = 0; x <= 52; x += 1) {
      dominant.add(dominantVisualBiomesAt(x, y, 52, 34, 7341)[0].biome);
    }
  }
  assert.deepEqual([...dominant].sort(), ["heath", "meadow"]);
  // heath owns the northeast corner, meadow the southwest
  assert.equal(dominantVisualBiomesAt(50, 2, 52, 34, 7341)[0].biome, "heath");
  assert.equal(dominantVisualBiomesAt(4, 30, 52, 34, 7341)[0].biome, "meadow");
});

test("the safe-zone center remains meadow while outer regions transition", () => {
  assert.equal(dominantVisualBiomesAt(26, 17, 52, 34, 7341)[0].biome, "meadow");
  const transitionSamples = [];
  for (let x = 0; x <= 52; x += 0.5) {
    const pair = dominantVisualBiomesAt(x, 8, 52, 34, 7341);
    if (pair[0].weight < 0.84) transitionSamples.push(pair);
  }
  assert.ok(transitionSamples.length > 0, "expected a soft multi-tile biome transition");
});
