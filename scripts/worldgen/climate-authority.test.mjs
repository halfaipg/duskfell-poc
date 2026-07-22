import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateWorld } from "../worldgen-v2/world-pipeline.mjs";
import { readRecipe } from "./recipe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RECIPE = path.join(ROOT, "worlds/recipes/duskfell-valley.json");

test("climate authority is deterministic, diverse, and season-ready", () => {
  const recipe = readRecipe(RECIPE);
  const first = generateWorld(recipe);
  const second = generateWorld(recipe);

  assert.deepEqual(first.climate, second.climate);
  assert.equal(first.climate.schema, "duskfell-climate-authority-v1");
  assert.equal(first.climate.seasonality.seasons.length, 4);
  assert.match(first.climate.weatherBaseline.runtimeStatus, /not implemented/);
  assert.ok(new Set(first.climate.zones.rows.join("")).size >= 8);

  for (const name of ["temperature", "precipitation", "moisture", "humidity", "fogPotential", "windExposure", "growingSeason"]) {
    const values = first.fields[name].flat();
    assert.ok(values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1), `${name} must be bounded`);
    assert.ok(Math.max(...values) - Math.min(...values) > 0.15, `${name} must vary across the world`);
  }
});
