import assert from "node:assert/strict";
import test from "node:test";

import { EROSION_ALGORITHM, erodeHeightfield } from "./erosion-authority.mjs";

test("hydraulic erosion is deterministic, finite, and materially changes relief", () => {
  const width = 25;
  const height = 19;
  const input = Float64Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return 0.18 + x * 0.012 + y * 0.006 + Math.sin(x * 0.71 + y * 0.29) * 0.045;
  });
  const options = { seed: 74291, iterations: 6, thermalRate: 0.075 };
  const first = erodeHeightfield(input, width, height, options);
  const second = erodeHeightfield(input, width, height, options);
  assert.equal(first.metadata.algorithm, EROSION_ALGORITHM);
  assert.equal(first.metadata.outputSha256, second.metadata.outputSha256);
  assert.deepEqual(first.elevation, second.elevation);
  assert.ok(first.metadata.metrics.changedSamples > width * height * 0.5);
  assert.ok(first.metadata.metrics.maxErosion > 0);
  assert.ok(first.metadata.metrics.maxDeposition > 0);
  assert.ok([...first.elevation].every(Number.isFinite));
});

test("global-coordinate rainfall produces identical protected overlap interiors", () => {
  const globalWidth = 54;
  const height = 24;
  const iterations = 4;
  const global = Float64Array.from({ length: globalWidth * height }, (_, index) => {
    const x = index % globalWidth;
    const y = Math.floor(index / globalWidth);
    return 0.25 + x * 0.003 + Math.sin(x * 0.19) * 0.04 + Math.cos(y * 0.31) * 0.03;
  });
  const leftOrigin = 0;
  const rightOrigin = 18;
  const windowWidth = 36;
  const slice = (origin) => Float64Array.from({ length: windowWidth * height }, (_, index) => {
    const x = index % windowWidth;
    const y = Math.floor(index / windowWidth);
    return global[y * globalWidth + origin + x];
  });
  const left = erodeHeightfield(slice(leftOrigin), windowWidth, height, { seed: 91, iterations, originX: leftOrigin });
  const right = erodeHeightfield(slice(rightOrigin), windowWidth, height, { seed: 91, iterations, originX: rightOrigin });
  const protectedMargin = iterations + 2;
  for (let y = protectedMargin; y < height - protectedMargin; y += 1) {
    for (let globalX = rightOrigin + protectedMargin; globalX < leftOrigin + windowWidth - protectedMargin; globalX += 1) {
      const leftValue = left.elevation[y * windowWidth + globalX - leftOrigin];
      const rightValue = right.elevation[y * windowWidth + globalX - rightOrigin];
      assert.equal(leftValue, rightValue, `erosion overlap drift at ${globalX},${y}`);
    }
  }
});

test("disabled erosion preserves the input exactly", () => {
  const input = Float64Array.from([0.1, 0.2, 0.3, 0.4]);
  const result = erodeHeightfield(input, 2, 2, { enabled: false, iterations: 12 });
  assert.deepEqual(result.elevation, input);
  assert.equal(result.metadata.config.iterations, 0);
  assert.equal(result.metadata.metrics.changedSamples, 0);
});
