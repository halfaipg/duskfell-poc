import assert from "node:assert/strict";
import test from "node:test";

import { ecologyActionForObject, nearestEcologyAction } from "./nearby-ecology-action.js";

test("nearest ecology action describes quiet deadwood without world labels", () => {
  const action = nearestEcologyAction(
    [
      deadwood("far-log", 220, 100, 0.8),
      deadwood("near-log", 112, 100, 0.72),
    ],
    { x: 100, y: 100 },
  );

  assert.equal(action.id, "near-log");
  assert.equal(action.label, "Deadwood: soft rot");
  assert.equal(action.action, "Gather deadwood");
  assert.equal(action.tone, "decay");
});

test("mycelium prompts use ecology pressure state", () => {
  const pressures = new Map([
    [
      "mycelium",
      {
        state: "charged-hungry",
        hunger: 0.7,
        feedStrength: 0,
        chargeStrength: 0.8,
      },
    ],
  ]);
  const action = ecologyActionForObject(mycelium("mycelium", 100, 100, 1, 4), pressures);

  assert.equal(action.label, "Mycelium: charged and hungry");
  assert.equal(action.action, "Feed mycelium");
  assert.equal(action.tone, "charge");
});

test("trees ruins and coils expose resource actions", () => {
  assert.deepEqual(ecologyActionForObject(tree("tree", "ancient", "ironleaf")).label, "Ancient ironleaf");
  assert.equal(ecologyActionForObject(tree("tree", "ancient", "ironleaf")).action, "Gather wood");
  assert.equal(ecologyActionForObject(ruin("ruin", 0.74, 128000)).label, "Ancient ruin: crumbling");
  assert.equal(ecologyActionForObject(ruin("ruin", 0.74, 128000)).action, "Gather stone");
  assert.equal(ecologyActionForObject(coil("coil", 3, 5)).label, "Field coil: charged");
  assert.equal(ecologyActionForObject(coil("coil", 3, 5)).action, "Draw charge");
  assert.equal(ecologyActionForObject(coil("spent", 0, 5)).action, "Inspect coil");
});

test("nearest ecology action ignores depleted and distant objects", () => {
  const objects = [
    { ...deadwood("empty-log", 102, 100, 0.8), resources: [{ kind: "deadwood", amount: 0, maxAmount: 4 }] },
    tree("distant-tree", "mature", "shadebark", 500, 100),
  ];

  assert.equal(nearestEcologyAction(objects, { x: 100, y: 100 }, { radius: 140 }), null);
});

function deadwood(id, x, y, decay) {
  return {
    id,
    kind: "deadwood",
    label: "Fallen Log",
    x,
    y,
    resources: [{ kind: "deadwood", amount: 2, maxAmount: 4 }],
    lifecycle: { family: "deadwood", stage: "decaying", decay, health: 0.2 },
  };
}

function mycelium(id, x, y, amount, maxAmount) {
  return {
    id,
    kind: "myceliumPatch",
    label: "Mycelium",
    x,
    y,
    resources: [{ kind: "mycelium", amount, maxAmount }],
    lifecycle: { family: "mycelium", stage: "fruiting", decay: 0.6, growth: amount / maxAmount },
  };
}

function tree(id, stage, species, x = 100, y = 100) {
  return {
    id,
    kind: "saplingTree",
    label: "Tree",
    x,
    y,
    resources: [{ kind: "wood", amount: 4, maxAmount: 8 }],
    lifecycle: { family: "tree", stage, species, growth: 0.8, health: 0.9 },
  };
}

function ruin(id, decay, ageYears) {
  return {
    id,
    kind: "ruin",
    label: "Ruin",
    x: 100,
    y: 100,
    resources: [{ kind: "stone", amount: 3, maxAmount: 6 }],
    lifecycle: { family: "mineral", stage: "ancient-ruin", decay, ageYears, health: 0.3 },
  };
}

function coil(id, amount, maxAmount) {
  return {
    id,
    kind: "fieldCoil",
    label: "Field Coil",
    x: 100,
    y: 100,
    resources: [{ kind: "charge", amount, maxAmount }],
    lifecycle: { family: "machine", stage: amount > 0 ? "sparking" : "spent", growth: amount / maxAmount },
  };
}
