import crypto from "node:crypto";

const NEIGHBORS = Object.freeze([
  [-1, -1, Math.SQRT1_2], [0, -1, 1], [1, -1, Math.SQRT1_2],
  [-1, 0, 1],                         [1, 0, 1],
  [-1, 1, Math.SQRT1_2],  [0, 1, 1],  [1, 1, Math.SQRT1_2],
]);

export const EROSION_ALGORITHM = "duskfell-hydraulic-erosion-v1";

export function erodeHeightfield(input, width, height, options = {}) {
  validateDimensions(input, width, height);
  const config = normalizeErosionConfig(options);
  const before = Float64Array.from(input);
  const terrain = Float64Array.from(input);
  const cells = width * height;
  const water = new Float64Array(cells);
  const sediment = new Float64Array(cells);
  const waterDelta = new Float64Array(cells);
  const sedimentDelta = new Float64Array(cells);
  const movedWater = new Float64Array(cells);
  const steepestDrop = new Float64Array(cells);
  const terrainDelta = new Float64Array(cells);
  let erodedMass = 0;
  let depositedMass = 0;

  for (let iteration = 0; iteration < config.iterations; iteration += 1) {
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (terrain[index] <= config.seaLevel) continue;
      const rainfall = config.rainfall * (0.72 + hash01(x + config.originX, y + config.originY, config.seed + iteration * 104729) * 0.56);
      water[index] += rainfall;
    }

    waterDelta.fill(0);
    sedimentDelta.fill(0);
    movedWater.fill(0);
    steepestDrop.fill(0);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const available = water[index];
      if (available <= 1e-12 || terrain[index] <= config.seaLevel) continue;
      const surface = terrain[index] + available;
      const lower = [];
      let pressure = 0;
      for (const [dx, dy, distanceWeight] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        const drop = Math.max(0, surface - (terrain[next] + water[next])) * distanceWeight;
        if (drop <= 0) continue;
        lower.push([next, drop]);
        pressure += drop;
        steepestDrop[index] = Math.max(steepestDrop[index], drop);
      }
      if (pressure <= 1e-12) continue;
      const totalOut = Math.min(available, pressure * config.flowRate);
      const carried = sediment[index] * Math.min(1, totalOut / Math.max(available, 1e-12));
      waterDelta[index] -= totalOut;
      sedimentDelta[index] -= carried;
      movedWater[index] = totalOut;
      for (const [next, drop] of lower) {
        const fraction = drop / pressure;
        waterDelta[next] += totalOut * fraction;
        sedimentDelta[next] += carried * fraction;
      }
    }

    for (let index = 0; index < cells; index += 1) {
      water[index] = Math.max(0, water[index] + waterDelta[index]);
      sediment[index] = Math.max(0, sediment[index] + sedimentDelta[index]);
      if (terrain[index] <= config.seaLevel) {
        const deposit = sediment[index] * config.depositionRate;
        terrain[index] += deposit;
        sediment[index] -= deposit;
        depositedMass += deposit;
        water[index] = 0;
        continue;
      }
      const capacity = Math.max(
        config.minimumCapacity,
        movedWater[index] * Math.max(config.minimumSlope, steepestDrop[index]) * config.sedimentCapacity,
      );
      if (sediment[index] > capacity) {
        const deposit = (sediment[index] - capacity) * config.depositionRate;
        terrain[index] += deposit;
        sediment[index] -= deposit;
        depositedMass += deposit;
      } else {
        const removable = Math.max(0, terrain[index] - config.bedrock);
        const erosion = Math.min(removable, (capacity - sediment[index]) * config.erosionRate);
        terrain[index] -= erosion;
        sediment[index] += erosion;
        erodedMass += erosion;
      }
      water[index] *= 1 - config.evaporation;
    }

    if (config.thermalRate > 0) {
      terrainDelta.fill(0);
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (terrain[index] <= config.seaLevel) continue;
        let target = -1;
        let largestDrop = config.talus;
        for (const [dx, dy, distanceWeight] of NEIGHBORS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
          const drop = (terrain[index] - terrain[next]) * distanceWeight;
          if (drop > largestDrop) {
            largestDrop = drop;
            target = next;
          }
        }
        if (target < 0) continue;
        const transfer = Math.min(
          Math.max(0, terrain[index] - config.bedrock),
          (largestDrop - config.talus) * config.thermalRate * 0.5,
        );
        terrainDelta[index] -= transfer;
        terrainDelta[target] += transfer;
      }
      for (let index = 0; index < cells; index += 1) terrain[index] += terrainDelta[index];
    }
  }

  for (let index = 0; index < cells; index += 1) terrain[index] = round(Math.max(config.bedrock, Math.min(config.ceiling, terrain[index])), 8);
  const delta = Float64Array.from(terrain, (value, index) => round(value - before[index], 8));
  let changedSamples = 0;
  let maxErosion = 0;
  let maxDeposition = 0;
  let deltaTotal = 0;
  for (const value of delta) {
    if (Math.abs(value) > 1e-8) changedSamples += 1;
    maxErosion = Math.max(maxErosion, -value);
    maxDeposition = Math.max(maxDeposition, value);
    deltaTotal += value;
  }
  return {
    elevation: terrain,
    delta,
    metadata: {
      schema: "duskfell-erosion-authority-v1",
      algorithm: EROSION_ALGORITHM,
      deterministic: true,
      config,
      inputSha256: hashFloat64(before),
      outputSha256: hashFloat64(terrain),
      metrics: {
        changedSamples,
        maxErosion: round(maxErosion, 8),
        maxDeposition: round(maxDeposition, 8),
        erodedMass: round(erodedMass, 8),
        depositedMass: round(depositedMass, 8),
        meanDelta: round(deltaTotal / cells, 10),
      },
    },
  };
}

export function normalizeErosionConfig(options = {}) {
  const config = {
    enabled: options.enabled ?? true,
    iterations: options.iterations ?? 6,
    rainfall: options.rainfall ?? 0.012,
    evaporation: options.evaporation ?? 0.34,
    flowRate: options.flowRate ?? 0.62,
    sedimentCapacity: options.sedimentCapacity ?? 3.2,
    erosionRate: options.erosionRate ?? 0.13,
    depositionRate: options.depositionRate ?? 0.21,
    minimumSlope: options.minimumSlope ?? 0.001,
    minimumCapacity: options.minimumCapacity ?? 0.000002,
    talus: options.talus ?? 0.028,
    thermalRate: options.thermalRate ?? 0,
    bedrock: options.bedrock ?? 0,
    ceiling: options.ceiling ?? 1,
    seaLevel: options.seaLevel ?? options.bedrock ?? 0,
    seed: options.seed ?? 0,
    originX: options.originX ?? 0,
    originY: options.originY ?? 0,
  };
  if (typeof config.enabled !== "boolean") throw new Error("erosion.enabled must be a boolean");
  integer(config.iterations, "erosion.iterations", 0, 64);
  integer(config.seed, "erosion.seed", 0, 0x7fffffff);
  integer(config.originX, "erosion.originX", -1000000000, 1000000000);
  integer(config.originY, "erosion.originY", -1000000000, 1000000000);
  finite(config.rainfall, "erosion.rainfall", 0, 0.2);
  finite(config.evaporation, "erosion.evaporation", 0, 1);
  finite(config.flowRate, "erosion.flowRate", 0, 2);
  finite(config.sedimentCapacity, "erosion.sedimentCapacity", 0, 20);
  finite(config.erosionRate, "erosion.erosionRate", 0, 1);
  finite(config.depositionRate, "erosion.depositionRate", 0, 1);
  finite(config.minimumSlope, "erosion.minimumSlope", 0, 1);
  finite(config.minimumCapacity, "erosion.minimumCapacity", 0, 1);
  finite(config.talus, "erosion.talus", 0, 1);
  finite(config.thermalRate, "erosion.thermalRate", 0, 1);
  finite(config.bedrock, "erosion.bedrock", -100000, 1);
  finite(config.ceiling, "erosion.ceiling", config.bedrock, 100000);
  finite(config.seaLevel, "erosion.seaLevel", -100000, 100000);
  if (!config.enabled) config.iterations = 0;
  return config;
}

function validateDimensions(input, width, height) {
  if (!input || typeof input.length !== "number") throw new Error("erosion elevation must be array-like");
  integer(width, "erosion.width", 2, 100000);
  integer(height, "erosion.height", 2, 100000);
  if (width * height !== input.length) throw new Error("erosion elevation dimensions do not match");
  for (const value of input) if (!Number.isFinite(value)) throw new Error("erosion elevation contains non-finite samples");
}

function hash01(x, y, seed) {
  let value = Math.imul((x | 0) ^ 0x9e3779b9, 374761393) ^ Math.imul((y | 0) + seed, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function hashFloat64(values) {
  const buffer = Buffer.allocUnsafe(values.length * 8);
  for (let index = 0; index < values.length; index += 1) buffer.writeDoubleLE(values[index], index * 8);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}

function finite(value, label, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}`);
}

function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer between ${min} and ${max}`);
}
