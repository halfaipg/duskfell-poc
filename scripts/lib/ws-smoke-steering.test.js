import assert from "node:assert/strict";
import test from "node:test";

import {
  createSteeringState,
  inputTowardTarget,
  SMOKE_INTERACT_DISTANCE,
} from "./ws-smoke-steering.js";

test("interacts with a small margin below the server interact radius", () => {
  const state = createSteeringState();
  const input = inputTowardTarget(state, { x: 0, y: 0 }, { id: "tree", x: 61, y: 0 });

  assert.equal(input.interact, true);
  assert.equal(input.right, false);
});

test("does not interact outside the smoke interact margin", () => {
  const state = createSteeringState();
  const input = inputTowardTarget(
    state,
    { x: 0, y: 0 },
    { id: "tree", x: SMOKE_INTERACT_DISTANCE + 2, y: 0 },
  );

  assert.equal(input.interact, false);
  assert.equal(input.right, true);
});

test("adds perpendicular input when stuck on a mostly horizontal approach", () => {
  const state = createSteeringState();
  const me = { x: 768, y: 528 };
  const target = { id: "grove", x: 640, y: 520 };

  let input = inputTowardTarget(state, me, target);
  for (let index = 0; index < 8; index += 1) {
    input = inputTowardTarget(state, me, target);
  }

  assert.equal(input.left, true);
  assert.equal(input.up || input.down, true);
});
