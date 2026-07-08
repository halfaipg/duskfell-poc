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

  state.updateRenderOffsets(players, { width: 20, height: 20 }, "local");
  state.updateVisualPositions(players, 100);

  assert.deepEqual(state.renderPosition(players[0]), { x: 10, y: 10 });
  assert.notDeepEqual(state.renderPosition(players[1]), { x: 10.1, y: 10 });
  assert.notDeepEqual(state.renderPosition(players[2]), { x: 10.2, y: 10 });
  assert.equal(state.variantIndexFor(players[1], 99), 0);
  assert.equal(state.variantIndexFor(players[2], 99), 1);
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
