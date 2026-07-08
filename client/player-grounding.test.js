import assert from "node:assert/strict";
import test from "node:test";

import { playerGroundingForTile } from "./player-grounding.js";

test("flat terrain grounding keeps actor shadow and body neutral", () => {
  const grounding = playerGroundingForTile({
    material: "grass",
    height: { slopeX: 0, slopeY: 0, range: 0 },
  });

  assert.equal(grounding.material, "grass");
  assert.equal(grounding.contact, 0);
  assert.equal(grounding.shadowOffsetX, 0);
  assert.equal(grounding.shadowOffsetY, 0);
  assert.equal(grounding.shadowScaleX, 1);
  assert.equal(grounding.shadowScaleY, 1);
  assert.equal(grounding.bodyOffsetY, 0);
  assert.equal(grounding.footfallOffsetY, 0);
});

test("sloped terrain grounding exposes bounded contact cues", () => {
  const grounding = playerGroundingForTile(
    {
      material: "stone",
      height: { slopeX: 1.2, slopeY: -0.5, range: 2 },
    },
    { moving: true, footfallStrength: 0.8 },
  );

  assert.equal(grounding.material, "stone");
  assert.ok(grounding.contact > 0);
  assert.ok(Math.abs(grounding.shadowOffsetX) <= 3.5);
  assert.ok(grounding.shadowOffsetY > 0 && grounding.shadowOffsetY <= 2.4);
  assert.ok(grounding.shadowScaleX > 1 && grounding.shadowScaleX <= 1.18);
  assert.ok(grounding.shadowScaleY >= 0.84 && grounding.shadowScaleY < 1);
  assert.ok(grounding.bodyOffsetY > 0 && grounding.bodyOffsetY <= 0.85);
  assert.ok(grounding.footfallOffsetY > 0 && grounding.footfallOffsetY <= 2.8);
});

test("idle actors do not bob on slopes while shadows still follow terrain contact", () => {
  const grounding = playerGroundingForTile(
    {
      material: "dirt",
      height: { slopeX: -0.8, slopeY: 0.3, range: 1.4 },
    },
    { moving: false, footfallStrength: 1 },
  );

  assert.equal(grounding.bodyOffsetY, 0);
  assert.ok(grounding.shadowOffsetY > 0);
  assert.ok(grounding.footfallOffsetY > 0);
});
