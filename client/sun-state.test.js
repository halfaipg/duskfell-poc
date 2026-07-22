import test from "node:test";
import assert from "node:assert/strict";

import { setSun, shadowCast } from "./sun-state.js";

test("sun-cast shadows rotate and lengthen toward the horizon", () => {
  setSun({ elevation: 0.85, direction: { x: -0.45, y: -0.55, z: 0.85 } });
  const noon = shadowCast();
  setSun({ elevation: 0.12, direction: { x: -0.72, y: 0.68, z: 0.12 } });
  const evening = shadowCast();

  assert.ok(evening.length > noon.length);
  assert.notEqual(Math.sign(evening.dirX), Math.sign(noon.dirX));
  assert.ok(evening.alpha > 0);
});

test("sun-cast directional shadows switch off at night", () => {
  setSun({ elevation: -0.4, direction: { x: 0.2, y: 0.3, z: -0.4 } });
  const night = shadowCast();
  assert.equal(night.length, 0);
  assert.equal(night.alpha, 0);
  assert.equal(night.daylight, 0);
});
