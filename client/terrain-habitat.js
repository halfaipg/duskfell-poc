import { clamp, noise2d } from "./terrain-primitives.js";

export function terrainHabitatForTile(x, y, biome, height, profile, openSpace) {
  const broad = normalizedNoise(x * 0.105, y * 0.105, profile.seed + 1217);
  const secondary = normalizedNoise(x * 0.19, y * 0.19, profile.seed + 1321);
  const slope = clamp((height?.range ?? 0) / 3, 0, 1);
  const pathPressure = biome.pathPressure ?? 0;
  const waterPressure = biome.waterPressure ?? 0;
  const plazaPressure = biome.plazaPressure ?? 0;
  const windExposure = biome.windExposure ?? 0;
  const humidity = biome.humidity ?? biome.moisture ?? 0.5;
  const clearance = clamp(
    Math.max(pathPressure * 1.28, plazaPressure * 1.4, waterPressure, slope > 0.78 ? slope : 0),
    0,
    1,
  );
  const patchSupport = broad * 0.72 + secondary * 0.28;
  const negativeSpace = clamp(openSpace * (0.72 + (1 - broad) * 0.28), 0, 1);
  const scores = {
    woodland: clamp(
      (biome.vegetation ?? 0) * 0.82
        + (biome.moisture ?? 0.5) * 0.18
        + patchSupport * 0.32
        - (biome.rockiness ?? 0) * 0.18
        - windExposure * 0.15,
      0,
      1,
    ),
    wetland: clamp(
      (biome.shorePressure ?? 0) * 0.56
        + humidity * 0.26
        + (1 - (biome.elevation ?? 0.5)) * 0.12
        + patchSupport * 0.16,
      0,
      1,
    ),
    rocky: clamp(
      (biome.rockiness ?? 0) * 0.62
        + (biome.elevation ?? 0.5) * 0.22
        + slope * 0.28
        + secondary * 0.14
        - (biome.vegetation ?? 0) * 0.2,
      0,
      1,
    ),
    scrub: clamp(
      (biome.dryness ?? (1 - (biome.moisture ?? 0.5))) * 0.42
        + (biome.vegetation ?? 0) * 0.3
        + patchSupport * 0.2
        + (biome.rockiness ?? 0) * 0.12,
      0,
      1,
    ),
  };
  const [kind, rawStrength] = Object.entries(scores).sort((left, right) => right[1] - left[1])[0];
  const strength = clamp(rawStrength * (1 - clearance) * (1 - negativeSpace * 0.6), 0, 1);
  const band = strength >= 0.67 ? "core" : strength >= 0.46 ? "edge" : "open";

  return {
    kind: band === "open" ? "open" : kind,
    band,
    strength,
    clearance,
    negativeSpace,
    patch: patchSupport,
  };
}

function normalizedNoise(x, y, seed) {
  return clamp((noise2d(x, y, seed) + 1) / 2, 0, 1);
}
