import assert from "node:assert/strict";
import test from "node:test";

import { carriedChargeEffect, carriedDecayEffect } from "./carried-decay-effects.js";

test("creates carried spore effect from compostable inventory decay", () => {
  const effect = carriedDecayEffect(
    player([
      {
        itemId: "trail-kit",
        quantity: 1,
        lifecycle: {
          compostable: true,
          decay: 0.82,
        },
      },
    ]),
  );

  assert.equal(effect.kind, "carried-spores");
  assert.ok(effect.intensity > 0.25);
  assert.ok(effect.moteCount >= 2);
  assert.ok(effect.radius > 14);
  assert.ok(effect.lift > 26);
});

test("spores in inventory also create carried spore pressure", () => {
  const effect = carriedDecayEffect(player([{ itemId: "spores", quantity: 3 }]));

  assert.equal(effect.kind, "carried-spores");
  assert.ok(effect.sporePressure > 0);
  assert.ok(effect.intensity > 0);
});

test("ignores fresh non-compostable or malformed inventory", () => {
  assert.equal(
    carriedDecayEffect(
      player([
        {
          itemId: "ore",
          quantity: 1,
          lifecycle: {
            compostable: false,
            decay: 1,
          },
        },
      ]),
    ),
    null,
  );
  assert.equal(carriedDecayEffect({ id: "p1" }), null);
});

test("caps carried spore motes", () => {
  const effect = carriedDecayEffect(
    player([
      {
        itemId: "trail-kit",
        quantity: 999,
        lifecycle: {
          compostable: true,
          decay: 1,
        },
      },
      { itemId: "spores", quantity: 999 },
    ]),
    { limit: 4 },
  );

  assert.equal(effect.moteCount, 4);
  assert.equal(effect.intensity, 1);
});

test("creates carried charge sparks from player resource summary", () => {
  const effect = carriedChargeEffect(player([], { charge: 3 }));

  assert.equal(effect.kind, "carried-charge");
  assert.equal(effect.charge, 3);
  assert.ok(effect.intensity > 0.5);
  assert.ok(effect.sparkCount >= 3);
});

test("creates carried charge sparks from inventory charge stacks", () => {
  const effect = carriedChargeEffect(player([{ itemId: "charge", quantity: 2 }]));

  assert.equal(effect.kind, "carried-charge");
  assert.equal(effect.charge, 2);
  assert.ok(effect.radius > 12);
});

test("ignores missing charge and caps charge sparks", () => {
  assert.equal(carriedChargeEffect(player([{ itemId: "wood", quantity: 3 }])), null);
  assert.equal(carriedChargeEffect({ id: "p1" }), null);

  const effect = carriedChargeEffect(player([{ itemId: "charge", quantity: 999 }], { charge: 999 }), {
    limit: 3,
  });
  assert.equal(effect.sparkCount, 3);
  assert.equal(effect.intensity, 1);
});

function player(items, resources = {}) {
  return {
    id: "player-1",
    resources,
    inventory: {
      capacitySlots: 8,
      items,
    },
  };
}
