import assert from "node:assert/strict";
import test from "node:test";

import { waterAuthorityFlowAt } from "./terrain-ground-patches.js";

test("water animation samples canonical D8 authority before procedural fallback", () => {
  const terrain = {
    sourceRegion: { offsetX: 10, offsetY: 20 },
    waterAuthority: {
      schema: "duskfell-water-authority-v1",
      samplesPerTile: 1,
      cellCols: 3,
      cellRows: 2,
      wetMask: [[1, 1, 0], [1, 1, 0]],
      flowStrength: [[1, 1, 0], [1, 1, 0]],
      flowDirectionD8: [[0, 0, -1], [2, 2, -1]],
    },
  };
  const east = waterAuthorityFlowAt(terrain, 10, 20, 1);
  assert.deepEqual(east, { x: 1, y: 0 });
  const mixed = waterAuthorityFlowAt(terrain, 10, 20, 2.5);
  assert.ok(Math.abs(mixed.x - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(mixed.y - Math.SQRT1_2) < 1e-9);
  assert.equal(waterAuthorityFlowAt(terrain, 12, 20, 1), null);
});
