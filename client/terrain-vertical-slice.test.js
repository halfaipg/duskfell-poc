import assert from "node:assert/strict";
import test from "node:test";

import { loamVerticalSliceEnabled } from "./terrain-vertical-slice.js";

test("loam vertical slice is explicit and ignores unrelated art queries", () => {
  assert.equal(loamVerticalSliceEnabled("?verticalSlice=loam"), true);
  assert.equal(loamVerticalSliceEnabled("?verticalSlice=heath"), false);
  assert.equal(loamVerticalSliceEnabled("?biomeProof=loam"), false);
  assert.equal(loamVerticalSliceEnabled(""), false);
});
