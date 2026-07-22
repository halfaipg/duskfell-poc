export const MATERIAL_WEIGHT_FAMILIES = Object.freeze([
  "meadow",
  "loam",
  "wetSoil",
  "riverBank",
  "beach",
  "scree",
  "cliff",
  "snow",
  "water",
  "road",
  "settlement",
]);

export function attachMaterialWeights(input) {
  const bundle = structuredClone(input);
  const { cols, rows } = bundle.dimensions;
  const weights = Object.fromEntries(MATERIAL_WEIGHT_FAMILIES.map((name) => [name, matrix(rows, cols, 0)]));
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    const water = clamp(bundle.fields.water[y][x]);
    const terrestrial = 1 - water;
    const slope = clamp(bundle.fields.slope[y][x]);
    const rockiness = clamp(bundle.fields.rockiness[y][x]);
    const moisture = clamp(bundle.fields.moisture[y][x]);
    const snow = clamp(bundle.fields.snow[y][x]) * terrestrial;
    const trail = clamp(bundle.fields.trail?.[y]?.[x] ?? 0) * terrestrial;
    const settlement = clamp(bundle.fields.settlement?.[y]?.[x] ?? 0) * terrestrial;
    const nearbyWater = neighboringMaximum(bundle.fields.water, x, y);
    const shore = clamp((nearbyWater - water) * 1.45) * terrestrial;
    const lake = clamp(bundle.fields.lake[y][x]);
    const river = clamp(bundle.fields.river[y][x]);
    const cliff = smoothstep(0.54, 0.92, slope) * rockiness * terrestrial;
    const scree = smoothstep(0.34, 0.72, slope) * smoothstep(0.42, 0.82, rockiness) * (1 - cliff * 0.72) * terrestrial;
    const beach = shore * (0.42 + lake * 0.58) * (1 - smoothstep(0.45, 0.78, rockiness));
    const riverBank = shore * (0.35 + river * 0.65) * (0.48 + moisture * 0.52) * (1 - beach * 0.55);
    const wetSoil = smoothstep(0.58, 0.92, moisture) * (1 - rockiness * 0.66) * terrestrial * (1 - shore * 0.35);
    const meadow = clamp(bundle.biomeWeights.meadow[y][x] + bundle.biomeWeights.wetland[y][x] * 0.34) * terrestrial;
    const loam = clamp(bundle.biomeWeights.loam[y][x] + (1 - moisture) * 0.18) * terrestrial;
    const candidates = {
      meadow: meadow * (1 - trail * 0.8) * (1 - settlement * 0.9),
      loam: loam * (1 - trail * 0.75) * (1 - settlement * 0.8),
      wetSoil: wetSoil * 1.15,
      riverBank: riverBank * 1.45,
      beach: beach * 1.35,
      scree: scree * 1.25,
      cliff: cliff * 1.55,
      snow: snow * 2.4,
      water: water * 4,
      road: trail * 2.15,
      settlement: settlement * 2.35,
    };
    const normalized = normalize(candidates);
    for (const family of MATERIAL_WEIGHT_FAMILIES) weights[family][y][x] = normalized[family];
  }
  bundle.materialWeights = {
    schema: "duskfell-material-weights-v1",
    algorithm: "continuous-terrain-family-blend-v1",
    normalization: "sum-to-one-per-tile",
    families: [...MATERIAL_WEIGHT_FAMILIES],
    weights,
  };
  delete bundle.contentSha256;
  return bundle;
}

function neighboringMaximum(values, x, y) {
  let maximum = values[y][x];
  for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
    maximum = Math.max(maximum, values[y + dy]?.[x + dx] ?? 0);
  }
  return maximum;
}

function normalize(values) {
  let total = 0;
  for (const value of Object.values(values)) total += Math.max(0, value);
  if (total <= 1e-12) values.meadow = total = 1;
  const output = {};
  let consumed = 0;
  let strongest = MATERIAL_WEIGHT_FAMILIES[0];
  for (const family of MATERIAL_WEIGHT_FAMILIES) {
    output[family] = round(Math.max(0, values[family]) / total, 6);
    consumed += output[family];
    if (values[family] > values[strongest]) strongest = family;
  }
  output[strongest] = round(output[strongest] + (1 - consumed), 6);
  return output;
}

function matrix(rows, cols, value) {
  return Array.from({ length: rows }, () => Array(cols).fill(value));
}

function smoothstep(a, b, value) {
  const amount = clamp((value - a) / Math.max(1e-9, b - a));
  return amount * amount * (3 - 2 * amount);
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}
