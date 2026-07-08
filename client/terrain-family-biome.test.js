import assert from "node:assert/strict";
import test from "node:test";

import {
  biomeForTile,
  buildTerrain,
  materialForTile,
} from "./terrain.js";
import { TERRAIN_FAMILY_ATLAS_ROLES, TERRAIN_FAMILY_CATALOG } from "./terrain-family.js";
import { PROJECTION } from "./projection.js";
import { testMap, testTerrain } from "./terrain-test-fixtures.js";

test("terrain families define atlas roles lifecycle resources and placement rules", () => {
  const terrain = buildTerrain(testMap());
  const familyIds = new Set(terrain.tiles.map((tile) => tile.family.id));
  const requiredFamilies = [
    "living-meadow",
    "old-growth-woodland",
    "charged-rotland",
    "scrub-path",
    "broken-cobble",
    "exposed-rock",
    "ruin-masonry",
    "reedbed-shore",
    "settlement-plaza",
  ];

  for (const [id, family] of Object.entries(TERRAIN_FAMILY_CATALOG)) {
    assert.equal(family.id, id);
    assert.equal(family.sourceTextureSize, 128);
    assert.equal(family.runtimeTileSize, PROJECTION.tileW);
    assert.deepEqual(family.atlasRoles, TERRAIN_FAMILY_ATLAS_ROLES);
    assert.ok(family.detailKinds.length > 0, `${id} should expose detail kinds`);
    assert.ok(family.resources.length > 0, `${id} should expose resource kinds`);
    assert.ok(family.lifecycle.family.length > 0, `${id} should expose lifecycle family`);
    assert.ok(family.lifecycle.decayYears[1] >= family.lifecycle.decayYears[0]);
    assert.ok(family.neighborPolicy.blendsWith.length > 0);
  }

  for (const id of requiredFamilies) {
    assert.ok(familyIds.has(id), `expected terrain to instantiate ${id}`);
  }

  for (const tile of terrain.tiles) {
    assert.equal(tile.family.runtimeTileSize, PROJECTION.tileW);
    assert.deepEqual(tile.family.atlasRoles, TERRAIN_FAMILY_ATLAS_ROLES);
    assert.equal(tile.family.placement.zone, tile.composition.zone);
    assert.equal(tile.family.placement.objectBand, tile.composition.objectBand);
    assert.ok(["flat", "slope", "high-ground", "low-ground", "waterline"].includes(tile.family.placement.elevationRole));
    assert.ok(tile.family.placement.transitionBias.length > 0);
    assert.ok(Array.isArray(tile.family.placement.sliceableObjectKinds));
  }

  assert.ok(
    terrain.tiles.some(
      (tile) => tile.composition.kitKind === "old-grove" && tile.family.id === "old-growth-woodland",
    ),
    "expected old grove kit to force old-growth family",
  );
  assert.ok(
    terrain.tiles.some(
      (tile) => tile.composition.kitKind === "stormroot-ruin" && tile.family.id === "charged-rotland",
    ),
    "expected stormroot kit to force charged rotland family",
  );
  assert.ok(
    terrain.tiles.some(
      (tile) => tile.composition.kitKind === "sunken-courtyard" && tile.family.id === "ruin-masonry",
    ),
    "expected ruin kits to force ruin masonry family",
  );
  assert.ok(
    terrain.tiles.some((tile) => tile.material === "water" && tile.family.id === "reedbed-shore"),
    "expected wet edges and water to use reedbed shore family",
  );
});

test("terrain biome channels are bounded and drive material selection", () => {
  const map = testMap();
  const terrain = buildTerrain(map);
  const biomeKeys = [
    "elevation",
    "moisture",
    "rockiness",
    "dryness",
    "settlementPressure",
    "plazaPressure",
    "pathPressure",
    "northSouthPathPressure",
    "eastWestPathPressure",
    "shorePathPressure",
    "waterPressure",
    "shorePressure",
    "vegetation",
    "detailDensity",
  ];

  for (const tile of terrain.tiles) {
    for (const key of biomeKeys) {
      assert.equal(typeof tile.biome[key], "number", `${key} should be numeric`);
      assert.ok(tile.biome[key] >= 0 && tile.biome[key] <= 1, `${key} should stay in [0, 1]`);
    }
  }

  assert.ok(terrain.tiles.some((tile) => tile.material === "water" && tile.biome.waterPressure > 0));
  assert.ok(terrain.tiles.some((tile) => tile.material === "settlement" && tile.biome.plazaPressure > 0));
  assert.ok(terrain.tiles.some((tile) => tile.biome.rockiness > 0.7));

  const directBiome = biomeForTile(0, 0, terrain.cols, terrain.rows, terrain.safeRadiusTiles, testTerrain());
  const directMaterial = materialForTile(0, 0, terrain.cols, terrain.rows, terrain.safeRadiusTiles, testTerrain());
  assert.equal(typeof directBiome.detailDensity, "number");
  assert.equal(typeof directMaterial, "string");
});
