import { D8 } from "./hydrology-authority.mjs";

export const WATER_AUTHORITY_SCHEMA = "duskfell-water-authority-v1";

export function waterAtTile(authority, x, y, fallback = 0) {
  if (!authority || authority.schema !== WATER_AUTHORITY_SCHEMA) return fallback;
  const samples = authority.samplesPerTile;
  const startX = Math.floor(x) * samples;
  const startY = Math.floor(y) * samples;
  let maximum = 0;
  for (let sy = 0; sy < samples; sy += 1) for (let sx = 0; sx < samples; sx += 1) {
    maximum = Math.max(maximum, authority.wetMask[startY + sy]?.[startX + sx] ?? 0);
  }
  return maximum;
}

export function buildWaterAuthority({
  elevationVertices,
  water,
  river,
  lake,
  directions,
  filledElevation,
  accumulation,
  samplesPerTile = 1,
  unitsPerTile = 64,
  heightScale = 2,
}) {
  const cellRows = water?.length ?? 0;
  const cellCols = water?.[0]?.length ?? 0;
  validateGrid(elevationVertices, cellRows + 1, cellCols + 1, "water authority elevation", Number.isFinite);
  validateGrid(water, cellRows, cellCols, "water authority wet mask", unitSample);
  validateGrid(river, cellRows, cellCols, "water authority river mask", unitSample);
  validateGrid(lake, cellRows, cellCols, "water authority lake mask", unitSample);
  const cells = cellCols * cellRows;
  if (!directions || directions.length !== cells || ![...directions].every((value) => Number.isInteger(value) && value >= -1 && value < D8.length)) {
    throw new Error("water authority flow directions are invalid");
  }
  if (!filledElevation || filledElevation.length !== cells || ![...filledElevation].every(Number.isFinite)) throw new Error("water authority filled elevation is invalid");
  if (!accumulation || accumulation.length !== cells || ![...accumulation].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("water authority flow accumulation is invalid");
  }
  if (!Number.isInteger(samplesPerTile) || samplesPerTile < 1 || samplesPerTile > 8) throw new Error("water authority samplesPerTile is invalid");
  if (!Number.isInteger(unitsPerTile) || unitsPerTile < 16 || unitsPerTile > 256) throw new Error("water authority unitsPerTile is invalid");
  if (!Number.isFinite(heightScale) || heightScale <= 0 || heightScale > 1000) throw new Error("water authority heightScale is invalid");

  let maximumAccumulation = 1;
  for (const value of accumulation) maximumAccumulation = Math.max(maximumAccumulation, value);
  const wetMask = matrix(cellRows, cellCols, 0);
  const surfaceHeight = matrix(cellRows, cellCols, 0);
  const depth = matrix(cellRows, cellCols, 0);
  const flowDirectionD8 = matrix(cellRows, cellCols, -1);
  const flowStrength = matrix(cellRows, cellCols, 0);
  let wetSamples = 0;
  let maximumDepth = 0;
  for (let y = 0; y < cellRows; y += 1) for (let x = 0; x < cellCols; x += 1) {
    const index = y * cellCols + x;
    const wet = round(clamp(water[y][x]), 6);
    wetMask[y][x] = wet;
    if (wet <= 0.001) continue;
    const bed = cellMean(elevationVertices, x, y);
    const depressionDepth = Math.max(0, filledElevation[index] - bed);
    const channelDepth = 0.012 + clamp(river[y][x]) * 0.018 + clamp(lake[y][x]) * 0.028;
    const normalizedDepth = wet * Math.max(channelDepth, depressionDepth + 0.006);
    const worldDepth = round(normalizedDepth * heightScale, 6);
    wetSamples += 1;
    maximumDepth = Math.max(maximumDepth, worldDepth);
    depth[y][x] = worldDepth;
    surfaceHeight[y][x] = round((bed + normalizedDepth) * heightScale, 6);
    flowDirectionD8[y][x] = directions[index];
    flowStrength[y][x] = round(wet * Math.log1p(accumulation[index]) / Math.log1p(maximumAccumulation), 6);
  }
  return {
    schema: WATER_AUTHORITY_SCHEMA,
    algorithm: "priority-flood-surface-depth-flow-v1",
    samplesPerTile,
    unitsPerTile,
    heightEncoding: "world-elevation-levels-v1",
    heightScale,
    cellCols,
    cellRows,
    wetMask,
    surfaceHeight,
    depth,
    flowDirectionD8,
    flowStrength,
    metrics: {
      wetSamples,
      maximumDepth: round(maximumDepth, 6),
    },
  };
}

function cellMean(vertices, x, y) {
  return (vertices[y][x] + vertices[y][x + 1] + vertices[y + 1][x] + vertices[y + 1][x + 1]) * 0.25;
}

function validateGrid(values, rows, cols, label, predicate) {
  if (!Array.isArray(values) || values.length !== rows || values.some((row) => !Array.isArray(row) || row.length !== cols || row.some((value) => !predicate(value)))) {
    throw new Error(`${label} dimensions or samples are invalid`);
  }
}

function unitSample(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function matrix(rows, cols, value) {
  return Array.from({ length: rows }, () => Array(cols).fill(value));
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}
