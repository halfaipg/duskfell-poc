import assert from "node:assert/strict";
import test from "node:test";

import {
  createPlayerRenderState,
  playerDistance,
  playerProximityClusters,
} from "./player-render-state.js";

test("player proximity clusters group connected nearby players", () => {
  const players = [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 0.9, y: 0 },
    { id: "c", x: 1.8, y: 0 },
    { id: "d", x: 300, y: 300 },
  ];

  const clusters = playerProximityClusters(players).map((cluster) =>
    cluster.map((player) => player.id),
  );

  assert.deepEqual(clusters, [["a", "b", "c"], ["d"]]);
});

test("render offsets spread crowded remote players while leaving local player anchored", () => {
  const state = createPlayerRenderState();
  const players = [
    { id: "local", x: 10, y: 10 },
    { id: "alpha", x: 10.1, y: 10 },
    { id: "bravo", x: 10.2, y: 10 },
  ];

  // offsets ease in over PLAYER_CLUSTER_SMOOTHING_MS, so run a few frames
  state.updateRenderOffsets(players, { width: 200, height: 200 }, "local", 100);
  state.updateRenderOffsets(players, { width: 200, height: 200 }, "local", 600);
  state.updateRenderOffsets(players, { width: 200, height: 200 }, "local", 1100);
  state.updateVisualPositions(players, 1100);

  assert.deepEqual(state.renderPosition(players[0]), { x: 10, y: 10 });
  assert.notDeepEqual(state.renderPosition(players[1]), { x: 10.1, y: 10 });
  assert.notDeepEqual(state.renderPosition(players[2]), { x: 10.2, y: 10 });
  assert.equal(state.variantIndexFor(players[1], 99), 0);
  assert.equal(state.variantIndexFor(players[2], 99), 1);
});

test("walking past a nearby player never displaces them", () => {
  const state = createPlayerRenderState();
  const bystander = { id: "idle", x: 100, y: 100 };
  // local walks past ~one tile away: closer than the old 118-unit cluster
  // radius, farther than genuine sprite overlap
  for (let step = 0; step < 8; step += 1) {
    const players = [{ id: "local", x: 40 + step * 20, y: 160 }, bystander];
    state.updateRenderOffsets(players, { width: 400, height: 400 }, "local", 100 + step * 100);
    state.updateVisualPositions(players, 100 + step * 100);
    assert.deepEqual(state.renderPosition(bystander), { x: 100, y: 100 });
  }
});

test("cluster offsets ease out instead of snapping when players separate", () => {
  const state = createPlayerRenderState();
  const bystander = { id: "idle", x: 100, y: 100 };
  const stacked = [{ id: "local", x: 100, y: 100 }, bystander];

  let now = 100;
  for (let frame = 0; frame < 30; frame += 1) {
    now += 50;
    state.updateRenderOffsets(stacked, { width: 400, height: 400 }, "local", now);
  }
  state.updateVisualPositions(stacked, now);
  const spread = state.renderPosition(bystander);
  const spreadDistance = Math.hypot(spread.x - 100, spread.y - 100);
  assert.ok(spreadDistance > 10, `expected spread, got ${spreadDistance}`);

  // local steps away: bystander should glide home, not teleport
  const apart = [{ id: "local", x: 300, y: 300 }, bystander];
  now += 50;
  state.updateRenderOffsets(apart, { width: 400, height: 400 }, "local", now);
  const easing = state.renderPosition(bystander);
  const easingDistance = Math.hypot(easing.x - 100, easing.y - 100);
  assert.ok(easingDistance > 1, "offset should not vanish in a single frame");
  assert.ok(easingDistance < spreadDistance, "offset should shrink toward zero");

  for (let frame = 0; frame < 40; frame += 1) {
    now += 50;
    state.updateRenderOffsets(apart, { width: 400, height: 400 }, "local", now);
  }
  assert.deepEqual(state.renderPosition(bystander), { x: 100, y: 100 });
});

test("render state smooths authoritative positions between samples", () => {
  const state = createPlayerRenderState();
  const first = { id: "p", x: 0, y: 0 };
  const second = { id: "p", x: 64, y: 0 };

  state.updateVisualPositions([first], 100);
  state.updateVisualPositions([second], 116);

  const position = state.renderPosition(second);
  assert.ok(position.x > 0 && position.x < 64);
  assert.equal(position.y, 0);
});

test("motion state tracks direction, movement, and stop grace", () => {
  const state = createPlayerRenderState();
  const idle = state.motionFor({ id: "p", x: 0, y: 0 }, 1, 100);
  assert.equal(idle.moving, false);
  assert.equal(idle.direction, "south");

  const moving = state.motionFor({ id: "p", x: 64, y: 0 }, 2, 200);
  assert.equal(moving.moving, true);
  assert.equal(moving.direction, "east");
  assert.ok(moving.speedRatio >= 0.62);

  const grace = state.motionFor({ id: "p", x: 64, y: 0 }, 3, 280);
  assert.equal(grace.moving, true);
  assert.equal(grace.direction, "east");

  const stopped = state.motionFor({ id: "p", x: 64, y: 0 }, 4, 500);
  assert.equal(stopped.moving, false);
  assert.equal(stopped.speedRatio, 0);
});

test("player distance uses world-space euclidean distance", () => {
  assert.equal(playerDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});
