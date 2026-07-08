import assert from "node:assert/strict";
import test from "node:test";

import { terrainResourceCues } from "./terrain-resource-cues.js";

test("terrain resource cues expose tree stage species seed and fullness signals", () => {
  const cues = terrainResourceCues({
    kind: "tree",
    species: "ironleaf",
    resources: [
      { kind: "wood", amount: 7, maxAmount: 10 },
      { kind: "seed", amount: 1, maxAmount: 1 },
    ],
    lifecycle: {
      family: "tree",
      stage: "ancient",
      species: "ironleaf",
      ageYears: 190,
      health: 0.7,
      growth: 1,
      decay: 0.22,
    },
  });

  assert.equal(cues.length, 2);
  assert.deepEqual(
    cues.map((cue) => cue.kind),
    ["organic-ring", "seed"],
  );
  assert.equal(cues[0].tone, "iron");
  assert.equal(cues[0].resource, "wood");
  assert.ok(cues[0].fullness > 0.69 && cues[0].fullness < 0.71);
  assert.ok(cues[0].agePressure > 0.75);
  assert.equal(cues[1].count, 1);
});

test("terrain resource cues distinguish deadwood rot spores mycelium hunger and charge", () => {
  const deadwood = terrainResourceCues({
    kind: "fallen-log",
    resources: [
      { kind: "deadwood", amount: 2, maxAmount: 4 },
      { kind: "spores", amount: 1, maxAmount: 2 },
    ],
    lifecycle: {
      family: "deadwood",
      stage: "decaying",
      ageYears: 18,
      health: 0.24,
      decay: 0.76,
      growth: 0,
    },
  });
  assert.deepEqual(
    deadwood.map((cue) => cue.kind),
    ["rot-feed", "spore"],
  );
  assert.equal(deadwood[0].tone, "spore");
  assert.ok(deadwood[0].decay > 0.75);

  const mycelium = terrainResourceCues({
    kind: "mushroom",
    resources: [{ kind: "mycelium", amount: 1, maxAmount: 4 }],
    lifecycle: { family: "mycelium", stage: "fruiting", health: 0.82, decay: 0.6, growth: 0.25 },
  });
  assert.equal(mycelium[0].kind, "mycelium");
  assert.equal(mycelium[0].tone, "hungry");

  const charge = terrainResourceCues({
    kind: "foundation",
    resources: [{ kind: "charge", amount: 3, maxAmount: 4 }],
    lifecycle: { family: "machine", stage: "sparking", health: 0.6, decay: 0.1, growth: 0.75 },
  });
  assert.equal(charge[0].kind, "charge");
  assert.equal(charge[0].tone, "arc");
});

test("terrain resource cues cover mineral and fiber nodes and stay bounded", () => {
  const cues = terrainResourceCues({
    kind: "ruin",
    resources: [
      { kind: "stone", amount: 3, maxAmount: 6 },
      { kind: "ore", amount: 2, maxAmount: 4 },
      { kind: "fiber", amount: 3, maxAmount: 3 },
      { kind: "seed", amount: 2, maxAmount: 2 },
      { kind: "mycelium", amount: 3, maxAmount: 4 },
    ],
    lifecycle: {
      family: "mineral",
      stage: "ancient-ruin",
      ageYears: 120000,
      health: 0.3,
      decay: 0.68,
      growth: 0,
    },
  });

  assert.equal(cues.length, 4);
  assert.deepEqual(
    cues.map((cue) => cue.kind),
    ["mineral", "mineral", "fiber", "seed"],
  );
  assert.equal(cues[0].tone, "stone");
  assert.equal(cues[1].tone, "ore");
  assert.ok(cues[0].agePressure > 0.7);
});

test("terrain resource cues ignore malformed or empty resource state", () => {
  assert.deepEqual(terrainResourceCues(null), []);
  assert.deepEqual(terrainResourceCues({ resources: [] }), []);
  assert.deepEqual(
    terrainResourceCues({
      resources: [
        { kind: "wood", amount: 0, maxAmount: 8 },
        { kind: "seed", amount: 1, maxAmount: 0 },
        { kind: "mycelium", amount: Number.NaN, maxAmount: 4 },
      ],
    }),
    [],
  );
});
