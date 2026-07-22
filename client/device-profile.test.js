import assert from "node:assert/strict";
import test from "node:test";

import { GRAPHICS_BUDGETS, selectGraphicsQuality } from "./device-profile.js";

test("graphics quality selection is explicit and deterministic", () => {
  assert.equal(selectGraphicsQuality({ search: "?quality=high", deviceMemory: 2 }), "high");
  assert.equal(selectGraphicsQuality({ search: "?quality=unknown", deviceMemory: 2 }), "low");
  assert.equal(selectGraphicsQuality({ deviceMemory: 8, hardwareConcurrency: 8 }), "balanced");
  assert.equal(selectGraphicsQuality({ userAgent: "iPhone", deviceMemory: 8 }), "low");
});

test("named graphics budgets preserve the painted baseline and bounded upgrades", () => {
  assert.equal(GRAPHICS_BUDGETS.low.waterAnimation, "static");
  assert.equal(GRAPHICS_BUDGETS.low.gpuGrass, false);
  assert.equal(GRAPHICS_BUDGETS.balanced.gpuGrass, false);
  assert.equal(GRAPHICS_BUDGETS.high.gpuGrass, true);
  assert.equal(GRAPHICS_BUDGETS.low.atmosphereMotion, "static");
  assert.equal(GRAPHICS_BUDGETS.high.atmosphereMotion, "drift");
  assert.ok(GRAPHICS_BUDGETS.low.maxAtmospherePatches < GRAPHICS_BUDGETS.high.maxAtmospherePatches);
  assert.ok(GRAPHICS_BUDGETS.low.glTexturePoolEntries < GRAPHICS_BUDGETS.high.glTexturePoolEntries);
  assert.ok(GRAPHICS_BUDGETS.low.dprCap < GRAPHICS_BUDGETS.high.dprCap);
});
