import assert from "node:assert/strict";
import test from "node:test";

import { ecologyGroundEffects } from "./ecology-ground-effects.js";

test("creates rot ground effects from deadwood lifecycle state", () => {
  const effects = ecologyGroundEffects([
    object("fallen-log", "deadwood", 100, 120, "deadwood", 2, 4, { decay: 0.8, health: 0.2 }),
  ]);

  assert.equal(effects.length, 1);
  assert.equal(effects[0].kind, "rot");
  assert.equal(effects[0].fullness, 0.5);
  assert.ok(effects[0].radius > 36);
  assert.ok(effects[0].intensity > 0.6);
});

test("creates mycelium blooms from live mycelium fullness", () => {
  const hungry = ecologyGroundEffects([
    object("hungry", "myceliumPatch", 100, 120, "mycelium", 1, 4, { health: 0.8 }),
  ])[0];
  const full = ecologyGroundEffects([
    object("full", "myceliumPatch", 100, 120, "mycelium", 4, 4, { health: 0.8 }),
  ])[0];

  assert.equal(hungry.kind, "mycelium");
  assert.ok(full.radius > hungry.radius);
  assert.ok(full.intensity > hungry.intensity);
  assert.equal(hungry.hunger, 0.75);
});

test("mycelium ground effects expose feeding and charge pressure", () => {
  const baseline = ecologyGroundEffects([
    object("mycelium", "myceliumPatch", 100, 120, "mycelium", 1, 4, { health: 0.8 }),
  ])[0];
  const feeding = ecologyGroundEffects(
    [
      object("mycelium", "myceliumPatch", 100, 120, "mycelium", 1, 4, { health: 0.8 }),
    ],
    {
      pressures: new Map([
        [
          "mycelium",
          {
            state: "feeding",
            feedStrength: 0.7,
            feedSources: 2,
            chargeStrength: 0.3,
            chargeSources: 1,
          },
        ],
      ]),
    },
  )[0];

  assert.equal(feeding.state, "feeding");
  assert.equal(feeding.feedSources, 2);
  assert.equal(feeding.chargeSources, 1);
  assert.ok(feeding.feedStrength > 0.69);
  assert.ok(feeding.chargeStrength > 0.29);
  assert.ok(feeding.radius > baseline.radius);
  assert.ok(feeding.intensity > baseline.intensity);
});

test("creates charge scars from field coil fullness", () => {
  const effects = ecologyGroundEffects([
    object("coil", "fieldCoil", 100, 120, "charge", 3, 5, { health: 0.8 }),
    object("spent", "fieldCoil", 120, 140, "charge", 0, 5, { health: 0.1 }),
  ]);

  assert.equal(effects[0].kind, "charge");
  assert.equal(effects[1].spent, true);
  assert.ok(effects[0].radius > effects[1].radius);
});

test("creates age and growth litter from tree-family lifecycle state", () => {
  const young = ecologyGroundEffects([
    object("young-tree", "saplingTree", 100, 120, "wood", 2, 4, {
      family: "tree",
      growth: 0.5,
      health: 0.9,
      ageYears: 12,
    }),
  ])[0];
  const ancient = ecologyGroundEffects([
    object("old-grove", "grove", 100, 120, "wood", 4, 4, {
      family: "tree",
      growth: 1,
      health: 0.45,
      ageYears: 220,
    }),
  ])[0];

  assert.equal(young.kind, "tree-litter");
  assert.equal(young.growth, 0.5);
  assert.ok(ancient.radius > young.radius);
  assert.ok(ancient.intensity > young.intensity);
  assert.ok(ancient.agePressure > young.agePressure);
});

test("creates mineral dust for aged mineral resource nodes", () => {
  const fresh = ecologyGroundEffects([
    object("fresh-ore", "ore", 100, 120, "ore", 4, 4, {
      family: "mineral",
      health: 0.9,
      ageYears: 1000,
    }),
  ])[0];
  const ancient = ecologyGroundEffects([
    object("ancient-ore", "ore", 100, 120, "ore", 4, 4, {
      family: "mineral",
      health: 0.35,
      ageYears: 160000,
    }),
  ])[0];

  assert.equal(fresh.kind, "mineral-dust");
  assert.ok(ancient.radius > fresh.radius);
  assert.ok(ancient.intensity > fresh.intensity);
  assert.equal(ancient.agePressure, 1);
});

test("ignores unsupported and malformed objects and caps effect count", () => {
  const objects = [
    { id: "bad", kind: "deadwood", x: Number.NaN, y: 0 },
    object("registrar", "registrar", 100, 120, "deed", 0, 0),
    ...Array.from({ length: 4 }, (_, index) =>
      object(`log-${index}`, "deadwood", 100 + index, 120, "deadwood", 1, 4),
    ),
  ];

  const effects = ecologyGroundEffects(objects, { limit: 2 });
  assert.equal(effects.length, 2);
  assert.ok(effects.every((effect) => effect.kind === "rot"));
});

function object(id, kind, x, y, resourceKind, amount, maxAmount, lifecycle = {}) {
  return {
    id,
    kind,
    x,
    y,
    resources: [{ kind: resourceKind, amount, maxAmount }],
    lifecycle,
  };
}
