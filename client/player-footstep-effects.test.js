import assert from "node:assert/strict";
import test from "node:test";

import { footstepStyleForMaterial, playerFootstepEffect } from "./player-footstep-effects.js";

test("idle players do not emit terrain footstep effects", () => {
  assert.equal(
    playerFootstepEffect({
      material: "dirt",
      motion: { moving: false, footfallStrength: 1, footfallSide: 1 },
    }),
    null,
  );
});

test("dirt footsteps produce deterministic dust contact", () => {
  const effect = playerFootstepEffect({
    material: "dirt",
    playerId: "player-a",
    motion: { moving: true, footfallStrength: 0.9, footfallSide: -1 },
    grounding: { footfallOffsetY: 1.25 },
  });

  assert.equal(effect.material, "dirt");
  assert.equal(effect.side, -1);
  assert.equal(effect.composite, "multiply");
  assert.ok(effect.imprint.width > effect.imprint.height);
  assert.ok(effect.imprint.y > 4);
  assert.ok(effect.particles.length >= 4);
  assert.ok(effect.particles.every((particle) => particle.kind === "dust"));
  assert.deepEqual(
    effect,
    playerFootstepEffect({
      material: "dirt",
      playerId: "player-a",
      motion: { moving: true, footfallStrength: 0.9, footfallSide: -1 },
      grounding: { footfallOffsetY: 1.25 },
    }),
  );
});

test("materials choose different contact particle families", () => {
  const field = playerFootstepEffect({
    material: "field",
    playerId: "player-a",
    motion: { moving: true, footfallStrength: 1, footfallSide: 1 },
  });
  const grass = playerFootstepEffect({
    material: "grass",
    playerId: "player-a",
    motion: { moving: true, footfallStrength: 1, footfallSide: 1 },
  });
  const stone = playerFootstepEffect({
    material: "stone",
    playerId: "player-a",
    motion: { moving: true, footfallStrength: 1, footfallSide: 1 },
  });

  assert.equal(field.composite, "screen");
  assert.ok(field.particles.some((particle) => particle.kind === "spark"));
  assert.ok(grass.particles.every((particle) => particle.kind === "blade"));
  assert.ok(stone.particles.every((particle) => particle.kind === "chip"));
});

test("unknown materials fall back to grass-like blade contacts", () => {
  assert.equal(footstepStyleForMaterial("moon-dust").family, "blade");
});
