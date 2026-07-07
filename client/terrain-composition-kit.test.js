import assert from "node:assert/strict";
import test from "node:test";

import {
  TERRAIN_COMPOSITION_KIT_CATALOG,
  compositionKitMembership,
  createTerrainCompositionKits,
  materialForCompositionKit,
} from "./terrain-composition-kit.js";

test("composition kit catalog documents the first coherent terrain scene kits", () => {
  const kinds = new Set(TERRAIN_COMPOSITION_KIT_CATALOG.map((kit) => kit.kind));

  assert.ok(kinds.has("settlement-core"));
  assert.ok(kinds.has("ancient-viaduct"));
  assert.ok(kinds.has("sunken-courtyard"));
  assert.ok(kinds.has("old-grove"));
  assert.ok(kinds.has("river-reedbed"));
  assert.ok(
    TERRAIN_COMPOSITION_KIT_CATALOG.every((kit) => kit.roles.length > 0 && kit.purpose.length > 0),
    "expected every kit to declare roles and intent",
  );
});

test("composition kits deterministically anchor roles and material overrides", () => {
  const kits = createTerrainCompositionKits(24, 16, 220 / 64, { seed: 7341 });
  const viaduct = kits.find((kit) => kit.kind === "ancient-viaduct");
  const courtyard = kits.find((kit) => kit.kind === "sunken-courtyard");
  const grove = kits.find((kit) => kit.kind === "old-grove");

  assert.ok(viaduct);
  assert.ok(courtyard);
  assert.ok(grove);
  assert.ok(Number.isInteger(viaduct.seed));

  const viaductTile = findTileWithRole(kits, "ancient-viaduct", "causeway");
  assert.ok(viaductTile, "expected to find a viaduct causeway tile outside higher-priority kits");
  const viaductRole = compositionKitMembership(viaductTile.x, viaductTile.y, kits, "ridge", {});
  assert.equal(viaductRole.kind, "ancient-viaduct");
  assert.equal(viaductRole.role, "causeway");
  assert.equal(materialForCompositionKit(viaductTile.x, viaductTile.y, "grass", { plazaPressure: 0 }, kits), "stone");

  const courtyardRole = compositionKitMembership(Math.floor(courtyard.x), Math.floor(courtyard.y), kits, "plaza", {});
  assert.equal(courtyardRole.kind, "sunken-courtyard");
  assert.equal(courtyardRole.role, "courtyard-floor");
  assert.equal(materialForCompositionKit(Math.floor(courtyard.x), Math.floor(courtyard.y), "grass", { plazaPressure: 0 }, kits), "stone");

  const groveRole = compositionKitMembership(Math.floor(grove.x), Math.floor(grove.y), kits, "grove", { vegetation: 0.8 });
  assert.equal(groveRole.kind, "old-grove");
  assert.equal(groveRole.role, "canopy");
});

function findTileWithRole(kits, kind, role) {
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 24; x += 1) {
      const membership = compositionKitMembership(x, y, kits, "ridge", { vegetation: 0.8 });
      if (membership?.kind === kind && membership.role === role) {
        return { x, y };
      }
    }
  }
  return null;
}
