import assert from "node:assert/strict";
import test from "node:test";

import { shouldUseRaisedTerrainArt } from "./terrain-rendering.js";

test("keeps flat surface materials on base terrain art", () => {
  assert.equal(shouldUseRaisedTerrainArt(null), false);
  assert.equal(shouldUseRaisedTerrainArt(tile({ material: "water", sloped: true })), false);
  assert.equal(shouldUseRaisedTerrainArt(tile({ material: "settlement", sloped: true })), false);
});

test("uses raised terrain art for sloped or ranged height fields", () => {
  assert.equal(shouldUseRaisedTerrainArt(tile({ sloped: true })), true);
  assert.equal(shouldUseRaisedTerrainArt(tile({ height: { range: 1, average: 0.5 } })), true);
});

test("uses raised terrain art for sharp edge drops and high ridges", () => {
  assert.equal(
    shouldUseRaisedTerrainArt(tile({ elevationEdges: [{ edge: "south", drop: 0.8 }] })),
    true,
  );
  assert.equal(
    shouldUseRaisedTerrainArt(
      tile({
        composition: { zone: "ridge", elevationBand: "high" },
        height: { range: 0, average: 1.2 },
      }),
    ),
    true,
  );
});

test("keeps low flat ground on base terrain art", () => {
  assert.equal(
    shouldUseRaisedTerrainArt(
      tile({
        composition: { zone: "lowland", elevationBand: "low" },
        height: { range: 0, average: 0.2 },
      }),
    ),
    false,
  );
});

function tile(overrides = {}) {
  return {
    material: "grass",
    sloped: false,
    height: { range: 0, average: 0 },
    elevationEdges: [],
    composition: {},
    ...overrides,
  };
}
