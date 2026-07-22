import { compositionKitMembership } from "./terrain-composition-kit.js";
import { terrainHabitatForTile } from "./terrain-habitat.js";
import { clamp } from "./terrain-primitives.js";

export function terrainCompositionForTile(x, y, material, biome, cols, rows, safeRadiusTiles, profile, height, compositionKits = []) {
  const elevationBand =
    biome.elevation > 0.72 ? "high" : biome.elevation < 0.26 || material === "water" ? "low" : "mid";
  const moistureBand =
    biome.waterPressure > 0 ? "water" : biome.moisture > 0.72 ? "wet" : biome.moisture < 0.34 ? "dry" : "temperate";
  const roadAxis = roadAxisForBiome(biome);
  const centerDistance = Math.hypot(x + 0.5 - cols / 2, y + 0.5 - rows / 2);
  const protectedCenter = centerDistance < safeRadiusTiles * 0.9;
  const groveScore = biome.vegetation * (1 - biome.rockiness * 0.58) * (1 - biome.pathPressure * 0.8);
  const ridgeScore = biome.rockiness * 0.65 + biome.elevation * 0.35 + clamp((height.range - 1) / 3, 0, 1) * 0.24;
  const landmarkPressure = compositionKitPressure(x, y, compositionKits);
  const openSpace = clamp(
    1 -
      Math.max(
        landmarkPressure * 0.95,
        biome.pathPressure * 0.9,
        biome.shorePressure * 1.12,
        biome.plazaPressure * 1.1,
        biome.rockiness * 0.64,
        groveScore * 0.54,
      ),
    0,
    1,
  );
  const habitat = terrainHabitatForTile(x, y, biome, height, profile, openSpace);
  const detailBudget = clamp(
    biome.detailDensity +
      habitat.strength * 0.18 +
      (ridgeScore > 0.82 ? 0.08 : 0) +
      (groveScore > 0.76 ? 0.07 : 0) -
      biome.plazaPressure * 0.65 -
      biome.pathPressure * 0.32 -
      openSpace * 0.42,
    0,
    1,
  );
  let zone = "meadow";
  let detailFamily = "grass";
  let objectBand = "open";

  if (material === "water") {
    zone = "water";
    detailFamily = "water";
    objectBand = "none";
  } else if (biome.plazaPressure > 0.18) {
    zone = "plaza";
    detailFamily = "settlement";
    objectBand = "settlement";
  } else if (biome.pathPressure > 0.18) {
    zone = "road";
    detailFamily = biome.shorePathPressure >= biome.pathPressure ? "shore-road" : "road";
    objectBand = "open";
  } else if (biome.shorePressure > 0.16) {
    zone = "shore";
    detailFamily = "shore";
    objectBand = "shore";
  } else if (ridgeScore > 0.78 || material === "stone") {
    zone = "ridge";
    detailFamily = "rock";
    objectBand = "rock";
  } else if (!protectedCenter && groveScore > 0.68) {
    zone = "grove";
    detailFamily = "woodland";
    objectBand = "vegetation";
  } else if (material === "dirt") {
    zone = "scrub";
    detailFamily = "scrub";
    objectBand = biome.rockiness > 0.55 ? "rock" : "open";
  }
  const kit = compositionKitMembership(x, y, compositionKits, zone, biome);
  if (kit?.kind === "ancient-viaduct") {
    if (kit.role === "causeway") {
      zone = "ridge";
      detailFamily = "ruin-road";
      objectBand = "ruin";
    } else if (kit.role === "rubble") {
      detailFamily = "ruin-rubble";
      objectBand = "ruin";
    }
  } else if (kit?.kind === "sunken-courtyard") {
    zone = kit.role === "courtyard-rubble" ? "ridge" : "plaza";
    detailFamily = kit.role === "stairs" ? "ruin-stairs" : kit.role.startsWith("wall") ? "ruin-wall" : "ruin-courtyard";
    objectBand = kit.role.startsWith("wall") || kit.role === "stairs" ? "architecture" : "ruin";
  } else if (kit?.kind === "gatehouse-ruin") {
    zone = kit.role === "rubble" ? "ridge" : kit.role === "threshold" ? "scrub" : "plaza";
    detailFamily =
      kit.role === "passage" ? "gatehouse-passage" : kit.role === "threshold" ? "gatehouse-threshold" : kit.role === "rubble" ? "gatehouse-rubble" : "gatehouse-tower";
    objectBand = kit.role === "threshold" ? "charged-ecology" : "architecture";
  } else if (kit?.kind === "stormroot-ruin") {
    zone = kit.role === "charged-core" || kit.role === "wire-scar" ? "scrub" : "grove";
    detailFamily =
      kit.role === "charged-core" ? "stormroot-core" : kit.role === "wire-scar" ? "stormroot-wire" : "stormroot-rot";
    objectBand = kit.role === "outer-root" ? "vegetation" : "charged-ecology";
  } else if (kit?.kind === "leywell-garden") {
    zone = kit.role === "basin" || kit.role === "fallen-rim" ? "plaza" : kit.role === "conduit" ? "scrub" : "grove";
    detailFamily =
      kit.role === "basin" ? "leywell-basin" : kit.role === "conduit" ? "leywell-conduit" : kit.role === "fallen-rim" ? "leywell-rubble" : "leywell-garden";
    objectBand = kit.role === "conduit" ? "charged-ecology" : kit.role === "wet-garden" ? "vegetation" : "architecture";
  }

  return {
    zone,
    elevationBand,
    moistureBand,
    roadAxis,
    detailFamily,
    objectBand,
    kitId: kit?.id ?? null,
    kitKind: kit?.kind ?? null,
    kitRole: kit?.role ?? "none",
    detailBudget,
    ridgeScore: clamp(ridgeScore, 0, 1),
    groveScore: clamp(groveScore, 0, 1),
    landmarkPressure,
    openSpace,
    habitat,
  };
}

function compositionKitPressure(x, y, compositionKits) {
  let pressure = 0;
  for (const kit of compositionKits) {
    const dx = x + 0.5 - kit.x;
    const dy = y + 0.5 - kit.y;
    const radius =
      kit.radius ??
      Math.max(
        kit.length ?? 0,
        (kit.halfWidth ?? 0) + 1.5,
        (kit.halfHeight ?? 0) + 1.5,
        kit.basinRadius ?? 0,
        1,
      );
    const influenceRadius = Math.max(1, radius + 2.8);
    pressure = Math.max(pressure, clamp(1 - Math.hypot(dx, dy) / influenceRadius, 0, 1));
  }
  return pressure;
}

function roadAxisForBiome(biome) {
  const northSouth = biome.northSouthPathPressure ?? 0;
  const eastWest = biome.eastWestPathPressure ?? 0;
  const shore = biome.shorePathPressure ?? 0;
  if (shore > northSouth && shore > eastWest) return "shore";
  if (Math.abs(northSouth - eastWest) < 0.08 && Math.max(northSouth, eastWest) > 0.16) return "cross";
  if (northSouth > eastWest && northSouth > 0.12) return "north-south";
  if (eastWest > 0.12) return "east-west";
  return "none";
}
