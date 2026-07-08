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
  assert.ok(kinds.has("stormroot-ruin"));
  assert.ok(kinds.has("leywell-garden"));
  assert.ok(kinds.has("gatehouse-ruin"));
  assert.ok(
    TERRAIN_COMPOSITION_KIT_CATALOG.every((kit) => kit.roles.length > 0 && kit.purpose.length > 0),
    "expected every kit to declare roles and intent",
  );
});

test("composition kits deterministically anchor roles and material overrides", () => {
  const cols = 40;
  const rows = 26;
  const kits = createTerrainCompositionKits(cols, rows, 320 / 64, { seed: 7341 });
  const viaduct = kits.find((kit) => kit.kind === "ancient-viaduct");
  const courtyard = kits.find((kit) => kit.kind === "sunken-courtyard");
  const gatehouse = kits.find((kit) => kit.kind === "gatehouse-ruin");
  const grove = kits.find((kit) => kit.kind === "old-grove");
  const stormroot = kits.find((kit) => kit.kind === "stormroot-ruin");
  const leywell = kits.find((kit) => kit.kind === "leywell-garden");

  assert.ok(viaduct);
  assert.ok(courtyard);
  assert.ok(gatehouse);
  assert.ok(grove);
  assert.ok(stormroot);
  assert.ok(leywell);
  assert.ok(Number.isInteger(viaduct.seed));

  const viaductTile = findTileWithRole(kits, cols, rows, "ancient-viaduct", "causeway");
  assert.ok(viaductTile, "expected to find a viaduct causeway tile outside higher-priority kits");
  const viaductRole = compositionKitMembership(viaductTile.x, viaductTile.y, kits, "ridge", {});
  assert.equal(viaductRole.kind, "ancient-viaduct");
  assert.equal(viaductRole.role, "causeway");
  assert.equal(materialForCompositionKit(viaductTile.x, viaductTile.y, "grass", { plazaPressure: 0 }, kits), "cobble");

  const courtyardRole = compositionKitMembership(Math.floor(courtyard.x), Math.floor(courtyard.y), kits, "plaza", {});
  assert.equal(courtyardRole.kind, "sunken-courtyard");
  assert.equal(courtyardRole.role, "courtyard-floor");
  assert.equal(materialForCompositionKit(Math.floor(courtyard.x), Math.floor(courtyard.y), "grass", { plazaPressure: 0 }, kits), "cobble");

  const gatehousePassage = findTileWithRole(kits, cols, rows, "gatehouse-ruin", "passage");
  const gatehouseThreshold = findTileWithRole(kits, cols, rows, "gatehouse-ruin", "threshold");
  assert.ok(gatehousePassage, "expected to find a gatehouse passage tile outside higher-priority kits");
  assert.ok(gatehouseThreshold, "expected to find a gatehouse threshold tile outside higher-priority kits");
  assert.equal(compositionKitMembership(gatehousePassage.x, gatehousePassage.y, kits, "plaza", {}).role, "passage");
  assert.equal(materialForCompositionKit(gatehousePassage.x, gatehousePassage.y, "grass", { plazaPressure: 0 }, kits), "ruin");
  assert.equal(materialForCompositionKit(gatehouseThreshold.x, gatehouseThreshold.y, "grass", { plazaPressure: 0 }, kits), "field");

  const groveRole = compositionKitMembership(Math.floor(grove.x), Math.floor(grove.y), kits, "grove", { vegetation: 0.8 });
  assert.equal(groveRole.kind, "old-grove");
  assert.equal(groveRole.role, "canopy");

  const stormrootTile = findTileWithRole(kits, cols, rows, "stormroot-ruin", "charged-core");
  assert.ok(stormrootTile, "expected to find a stormroot charged core tile outside higher-priority kits");
  const stormrootRole = compositionKitMembership(stormrootTile.x, stormrootTile.y, kits, "scrub", {});
  assert.equal(stormrootRole.kind, "stormroot-ruin");
  assert.equal(stormrootRole.role, "charged-core");
  assert.equal(materialForCompositionKit(stormrootTile.x, stormrootTile.y, "grass", { plazaPressure: 0 }, kits), "field");

  const leywellBasin = findTileWithRole(kits, cols, rows, "leywell-garden", "basin");
  const leywellConduit = findTileWithRole(kits, cols, rows, "leywell-garden", "conduit");
  assert.ok(leywellBasin, "expected to find a leywell basin tile outside higher-priority kits");
  assert.ok(leywellConduit, "expected to find a leywell conduit tile outside higher-priority kits");
  assert.equal(compositionKitMembership(leywellBasin.x, leywellBasin.y, kits, "plaza", {}).role, "basin");
  assert.equal(materialForCompositionKit(leywellBasin.x, leywellBasin.y, "grass", { plazaPressure: 0 }, kits), "ruin");
  assert.equal(materialForCompositionKit(leywellConduit.x, leywellConduit.y, "grass", { plazaPressure: 0 }, kits), "field");
});

function findTileWithRole(kits, cols, rows, kind, role) {
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const membership = compositionKitMembership(x, y, kits, "ridge", { vegetation: 0.8 });
      if (membership?.kind === kind && membership.role === role) {
        return { x, y };
      }
    }
  }
  return null;
}
