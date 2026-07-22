import assert from "node:assert/strict";
import test from "node:test";

import { calculatePriorityFlood } from "./hydrology-authority.mjs";
import { buildWaterAuthority, waterAtTile, WATER_AUTHORITY_SCHEMA } from "./water-authority.mjs";

test("water authority binds wetness, surface, depth, and flow to one heightfield", () => {
  const elevationVertices = [
    [0.50, 0.48, 0.46, 0.44],
    [0.48, 0.42, 0.40, 0.39],
    [0.46, 0.40, 0.36, 0.35],
    [0.44, 0.39, 0.35, 0.34],
  ];
  const water = [[0, 0.4, 0], [0, 1, 0.7], [0, 1, 1]];
  const river = [[0, 0.4, 0], [0, 1, 0.7], [0, 1, 1]];
  const lake = water.map((row) => row.map(() => 0));
  const cellElevation = Float64Array.from({ length: 9 }, (_, index) => {
    const x = index % 3;
    const y = Math.floor(index / 3);
    return (elevationVertices[y][x] + elevationVertices[y][x + 1] + elevationVertices[y + 1][x] + elevationVertices[y + 1][x + 1]) * 0.25;
  });
  const flood = calculatePriorityFlood(cellElevation, 3, 3);
  const authority = buildWaterAuthority({
    elevationVertices,
    water,
    river,
    lake,
    directions: flood.directions,
    filledElevation: flood.filled,
    accumulation: flood.accumulation,
    samplesPerTile: 1,
  });
  assert.equal(authority.schema, WATER_AUTHORITY_SCHEMA);
  assert.equal(authority.cellCols, 3);
  assert.equal(authority.cellRows, 3);
  assert.equal(authority.depth[0][0], 0);
  assert.equal(authority.surfaceHeight[0][0], 0);
  assert.equal(authority.flowDirectionD8[0][0], -1);
  assert.ok(authority.depth[1][1] > 0);
  assert.ok(authority.surfaceHeight[1][1] > cellElevation[4] * authority.heightScale);
  assert.ok(authority.flowStrength.flat().every((value) => value >= 0 && value <= 1));
  assert.equal(authority.metrics.wetSamples, water.flat().filter((value) => value > 0.001).length);
  assert.equal(waterAtTile(authority, 1, 1), 1);
});

test("water authority rejects drift between canonical grids", () => {
  assert.throws(() => buildWaterAuthority({
    elevationVertices: [[0, 0], [0, 0]],
    water: [[1]],
    river: [[1]],
    lake: [[0]],
    directions: new Int8Array(0),
    filledElevation: new Float64Array([0]),
    accumulation: new Float64Array([1]),
  }), /flow directions/);
});
