import assert from "node:assert/strict";
import test from "node:test";
import {
  atmosphereClimateForTile,
  atmosphereOpacity,
  atmospherePatchesForTerrain,
} from "./terrain-atmosphere.js";

function tile(x, y, fogPotential, overrides = {}) {
  return {
    x,
    y,
    biome: {
      elevation: 0.2,
      moisture: 0.75,
      humidity: 0.82,
      fogPotential,
      temperature: 0.45,
      windExposure: 0.12,
      waterPressure: 0,
      ...overrides,
    },
    height: { min: 0, average: 0.2, slopeX: 0.2, slopeY: -0.4 },
  };
}

test("terrain atmosphere is deterministic, sparse, and climate driven", () => {
  const terrain = {
    tiles: [
      tile(0, 0, 0.12),
      tile(1, 0, 0.84),
      tile(13, 0, 0.7),
      tile(26, 0, 0.1),
      tile(0, 13, 0.62),
    ],
  };
  const first = atmospherePatchesForTerrain(terrain);
  const second = atmospherePatchesForTerrain(terrain);

  assert.deepEqual(first, second);
  assert.equal(first.length, 3);
  assert.ok(first.every((patch) => patch.alpha > 0 && patch.alpha <= 0.16));
  assert.ok(first.every((patch) => patch.lengthTiles > 2));
});

test("fallback atmosphere favors humid sheltered lowlands", () => {
  const humid = atmosphereClimateForTile(tile(0, 0, undefined, {
    humidity: undefined,
    fogPotential: undefined,
    moisture: 0.9,
    elevation: 0.1,
    windExposure: 0.05,
    waterPressure: 0.5,
  }));
  const exposed = atmosphereClimateForTile(tile(0, 0, undefined, {
    humidity: undefined,
    fogPotential: undefined,
    moisture: 0.35,
    elevation: 0.85,
    windExposure: 0.9,
    waterPressure: 0,
  }));

  assert.ok(humid.fogPotential > 0.6);
  assert.equal(exposed.fogPotential, 0);
});

test("fog thins at midday without disappearing from wet ground", () => {
  const patch = { alpha: 0.14 };
  const noon = atmosphereOpacity(patch, 0.95);
  const dawn = atmosphereOpacity(patch, 0.04);
  const night = atmosphereOpacity(patch, -0.4);

  assert.ok(noon > 0);
  assert.ok(dawn > noon);
  assert.ok(night > noon);
  assert.ok(dawn <= 0.16);
});
