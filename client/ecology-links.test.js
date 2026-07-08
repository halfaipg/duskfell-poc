import assert from "node:assert/strict";
import test from "node:test";

import {
  COIL_MYCELIUM_LINK_RADIUS,
  ECOLOGY_FEED_LINK_RADIUS,
  coilMyceliumLinks,
  ecologyFeedLinks,
  ecologyObjectPressures,
  terrainDecayConsumerRules,
} from "./ecology-links.js";

test("links nearby deadwood to mycelium feed targets", () => {
  const links = ecologyFeedLinks([
    deadwood("decaying-grove-stump", 100, 120, 2, 5, 0.72),
    mycelium("shrine-mycelium-bloom", 170, 144, 3, 4),
  ]);

  assert.equal(links.length, 1);
  assert.equal(links[0].source.id, "decaying-grove-stump");
  assert.equal(links[0].target.id, "shrine-mycelium-bloom");
  assert.ok(links[0].distance < ECOLOGY_FEED_LINK_RADIUS);
  assert.ok(links[0].strength > 0);
  assert.equal(links[0].sourceFullness, 0.4);
  assert.equal(links[0].targetFullness, 0.75);
  assert.equal(links[0].hunger, 0.25);
  assert.equal(links[0].consumeKind, "deadwood");
  assert.equal(links[0].consumeAmount, 1);
  assert.equal(links[0].authoredRecipe, false);
});

test("ignores depleted deadwood and distant mycelium", () => {
  const links = ecologyFeedLinks([
    deadwood("empty-stump", 100, 120, 0, 5, 0.9),
    deadwood("distant-log", 100, 120, 3, 5, 0.8),
    mycelium("far-bloom", 400, 120, 1, 4),
  ]);

  assert.equal(links.length, 0);
});

test("sorts strongest nearby decay links first", () => {
  const links = ecologyFeedLinks([
    deadwood("weak-log", 90, 90, 1, 5, 0.2),
    deadwood("strong-stump", 124, 94, 2, 5, 0.95),
    mycelium("hungry-bloom", 150, 96, 1, 4),
  ]);

  assert.equal(links.length, 2);
  assert.equal(links[0].source.id, "strong-stump");
  assert.ok(links[0].strength > links[1].strength);
});

test("terrain authority decay recipes constrain mycelium feed visuals", () => {
  const rules = terrainDecayConsumerRules({
    decayConsumers: [
      {
        id: "veilcap-fruit",
        consumes: [{ kind: "spores", amount: 1 }],
      },
    ],
  });
  const links = ecologyFeedLinks(
    [
      deadwood("terrain-detail:fallen-log", 100, 120, 2, 5, 0.72),
      mycelium("terrain-detail:veilcap-fruit", 144, 136, 1, 4),
    ],
    ECOLOGY_FEED_LINK_RADIUS,
    { decayConsumerRules: rules },
  );

  assert.equal(links.length, 0);
});

test("terrain authority decay recipes mark accepted authored links", () => {
  const rules = terrainDecayConsumerRules({
    decayConsumers: [
      {
        id: "veilcap-fruit",
        consumes: [{ kind: "deadwood", amount: 2 }],
      },
    ],
  });
  const links = ecologyFeedLinks(
    [
      deadwood("terrain-detail:fallen-log", 100, 120, 2, 5, 0.72),
      mycelium("terrain-detail:veilcap-fruit", 144, 136, 1, 4),
    ],
    ECOLOGY_FEED_LINK_RADIUS,
    { decayConsumerRules: rules },
  );

  assert.equal(links.length, 1);
  assert.equal(links[0].consumeKind, "deadwood");
  assert.equal(links[0].consumeAmount, 2);
  assert.equal(links[0].authoredRecipe, true);
});

test("terrain authority decay rules map consumer ids to server object ids", () => {
  const rules = terrainDecayConsumerRules({
    decayConsumers: [
      {
        id: "old-grove-ring-mushroom-10-4-8800",
        consumes: [{ kind: "deadwood", amount: 1 }],
      },
    ],
  });

  assert.deepEqual(rules.get("terrain-detail:old-grove-ring-mushroom-10-4-8800"), [
    { kind: "deadwood", amount: 1 },
  ]);
});

test("links charged field coils to nearby mycelium", () => {
  const links = coilMyceliumLinks([
    coil("stormroot-field-coil", 180, 180, 1, 3),
    mycelium("veilcap-runner", 230, 212, 1, 4),
  ]);

  assert.equal(links.length, 1);
  assert.equal(links[0].source.id, "stormroot-field-coil");
  assert.equal(links[0].target.id, "veilcap-runner");
  assert.ok(links[0].distance < COIL_MYCELIUM_LINK_RADIUS);
  assert.ok(links[0].strength > 0);
  assert.equal(links[0].chargeFullness, 1 / 3);
  assert.equal(links[0].hunger, 0.75);
  assert.equal(links[0].spent, false);
});

test("keeps a faint spent coil link for readable crude wiring", () => {
  const links = coilMyceliumLinks([
    coil("spent-coil", 180, 180, 0, 3),
    mycelium("veilcap-runner", 230, 212, 2, 4),
  ]);

  assert.equal(links.length, 1);
  assert.equal(links[0].spent, true);
  assert.ok(links[0].strength > 0);
});

test("ecology object pressures classify hungry feeding and charged mycelium", () => {
  const feeding = ecologyObjectPressures([
    deadwood("near-log", 100, 120, 2, 4, 0.8),
    mycelium("feeding-bloom", 145, 128, 1, 4),
  ]).get("feeding-bloom");
  assert.equal(feeding.state, "feeding");
  assert.equal(feeding.feedSources, 1);
  assert.ok(feeding.feedStrength > 0);
  assert.equal(feeding.hunger, 0.75);

  const charged = ecologyObjectPressures([
    coil("charged-coil", 100, 120, 3, 3),
    mycelium("charged-bloom", 145, 128, 1, 4),
  ]).get("charged-bloom");
  assert.equal(charged.state, "charged-hungry");
  assert.equal(charged.chargeSources, 1);
  assert.ok(charged.chargeStrength > 0);

  const seeking = ecologyObjectPressures([
    mycelium("seeking-bloom", 100, 120, 1, 4),
  ]).get("seeking-bloom");
  assert.equal(seeking.state, "seeking");
  assert.equal(seeking.feedSources, 0);
  assert.equal(seeking.chargeSources, 0);
});

function deadwood(id, x, y, amount, maxAmount, decay) {
  return {
    id,
    kind: "deadwood",
    x,
    y,
    resources: [{ kind: "deadwood", amount, maxAmount }],
    lifecycle: { family: "deadwood", stage: "decaying", decay, growth: amount / maxAmount, health: 0.2 },
  };
}

function mycelium(id, x, y, amount, maxAmount) {
  return {
    id,
    kind: "myceliumPatch",
    x,
    y,
    resources: [{ kind: "mycelium", amount, maxAmount }],
    lifecycle: { family: "mycelium", stage: "fruiting", decay: 0.6, growth: amount / maxAmount, health: 0.8 },
  };
}

function coil(id, x, y, amount, maxAmount) {
  return {
    id,
    kind: "fieldCoil",
    x,
    y,
    resources: [{ kind: "charge", amount, maxAmount }],
    lifecycle: { family: "machine", stage: amount > 0 ? "sparking" : "spent", decay: 0.2, growth: amount / maxAmount, health: 0.6 },
  };
}
