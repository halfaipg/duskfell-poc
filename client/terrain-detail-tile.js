import { hash01 } from "./terrain-primitives.js";
import { tryAddDetail } from "./terrain-detail-placement-utils.js";

export function detailsForTile(tile, cols, rows, safeRadiusTiles, profile, occupiedFootprints) {
  if (tile.material === "water" || tile.material === "settlement") return [];
  if (tile.composition?.kitId) return [];

  const centerDistance = Math.hypot(tile.x + 0.5 - cols / 2, tile.y + 0.5 - rows / 2);
  if (centerDistance < safeRadiusTiles * 1.28) return [];

  const details = [];
  const baseRoll = hash01(tile.x, tile.y, profile.seed + 701);
  const secondRoll = hash01(tile.x, tile.y, profile.seed + 809);
  const thirdRoll = hash01(tile.x, tile.y, profile.seed + 907);
  const density = tile.composition?.detailBudget ?? tile.biome?.detailDensity ?? 0.5;
  const rockiness = tile.biome?.rockiness ?? 0.5;
  const vegetation = tile.biome?.vegetation ?? 0.5;
  const family = tile.composition?.detailFamily ?? "grass";
  const zone = tile.composition?.zone ?? "meadow";
  const openSpace = tile.composition?.openSpace ?? 0;
  const zoneRoll = hash01(tile.x, tile.y, profile.seed + 619);

  if (openSpace > 0.72 && baseRoll < 0.98) return [];
  if (zone === "meadow" && openSpace > 0.52 && baseRoll < 0.96) return [];

  if (zone === "grove" && zoneRoll > 0.955 - vegetation * 0.1) {
    if (tryAddDetail(details, tile, profile, "tree", zoneRoll, 0.74, 1.05, occupiedFootprints, cols, rows)) {
      if (secondRoll > 0.93 - density * 0.1) {
        tryAddDetail(details, tile, profile, "scrub", secondRoll, 0.36, 0.6, occupiedFootprints, cols, rows);
      }
      return details;
    }
  }

  if (zone === "shore" && zoneRoll > 0.91 - density * 0.12) {
    tryAddDetail(details, tile, profile, "reeds", zoneRoll, 0.42, 0.78, occupiedFootprints, cols, rows);
  }

  if ((zone === "ridge" || zone === "scrub") && zoneRoll > 0.978 - rockiness * 0.055) {
    if (tryAddDetail(details, tile, profile, "ruin", zoneRoll, 0.58, 0.86, occupiedFootprints, cols, rows)) {
      return details;
    }
  }

  if ((zone === "ridge" || family === "rock") && zoneRoll > 0.925 - density * 0.1) {
    tryAddDetail(details, tile, profile, "boulder", zoneRoll, 0.48, 0.82, occupiedFootprints, cols, rows);
  }

  if (family === "shore") {
    if (baseRoll > 0.92 - density * 0.13) tryAddDetail(details, tile, profile, "scrub", baseRoll, 0.34, 0.62, occupiedFootprints, cols, rows);
    if (secondRoll > 0.94 - density * 0.12) tryAddDetail(details, tile, profile, "pebble", secondRoll, 0.2, 0.34, occupiedFootprints, cols, rows);
    if (thirdRoll > 0.982 - vegetation * 0.08) tryAddDetail(details, tile, profile, "tuft", thirdRoll, 0.28, 0.44, occupiedFootprints, cols, rows);
    return details;
  }

  if (family === "road" || family === "shore-road") {
    if (baseRoll > 0.95 - density * 0.09) tryAddDetail(details, tile, profile, "pebble", baseRoll, 0.18, 0.3, occupiedFootprints, cols, rows);
    if (family === "shore-road" && secondRoll > 0.97 - vegetation * 0.07) {
      tryAddDetail(details, tile, profile, "tuft", secondRoll, 0.24, 0.38, occupiedFootprints, cols, rows);
    }
    return details;
  }

  if ((family === "rock" || tile.material === "stone" || rockiness > 0.78) && baseRoll > 0.93 - density * 0.24) {
    tryAddDetail(details, tile, profile, "rock", baseRoll, 0.38, 0.58, occupiedFootprints, cols, rows);
    if (secondRoll > 0.968 - density * 0.1) {
      tryAddDetail(details, tile, profile, "pebble", secondRoll, 0.24, 0.38, occupiedFootprints, cols, rows);
    }
    return details;
  }

  if (tile.material === "dirt") {
    if (baseRoll > 0.976 - rockiness * 0.13 + openSpace * 0.1) {
      tryAddDetail(details, tile, profile, "rock", baseRoll, 0.28, 0.44, occupiedFootprints, cols, rows);
    }
    if (secondRoll > 0.94 - density * 0.12 + openSpace * 0.1) {
      tryAddDetail(details, tile, profile, "pebble", secondRoll, 0.2, 0.34, occupiedFootprints, cols, rows);
    }
    if (thirdRoll > 0.997 - vegetation * 0.02 + openSpace * 0.05) {
      tryAddDetail(details, tile, profile, "stump", thirdRoll, 0.34, 0.5, occupiedFootprints, cols, rows);
    }
    return details;
  }

  if (family === "woodland" && baseRoll > 0.91 - density * 0.17) {
    tryAddDetail(details, tile, profile, baseRoll > 0.68 ? "scrub" : "tuft", baseRoll, 0.42, 0.78, occupiedFootprints, cols, rows);
    if (secondRoll > 0.945 - density * 0.1) {
      tryAddDetail(details, tile, profile, secondRoll > 0.7 ? "fallen-log" : "stump", secondRoll, 0.36, 0.58, occupiedFootprints, cols, rows);
    }
    if (thirdRoll > 0.984 - vegetation * 0.08) {
      tryAddDetail(details, tile, profile, "mushroom", thirdRoll, 0.26, 0.42, occupiedFootprints, cols, rows);
    }
    return details;
  }

  if ((tile.material === "grass" || tile.material === "field") && baseRoll > 0.992 - vegetation * 0.13 + openSpace * 0.1) {
    tryAddDetail(details, tile, profile, grassDetailKind(baseRoll, thirdRoll), baseRoll, 0.34, 0.62, occupiedFootprints, cols, rows);
    if (secondRoll > 0.992 - density * 0.06 + openSpace * 0.06) {
      tryAddDetail(details, tile, profile, "scrub", secondRoll, 0.42, 0.7, occupiedFootprints, cols, rows);
    }
    if (thirdRoll > 0.998 - vegetation * 0.018 + openSpace * 0.04) {
      tryAddDetail(details, tile, profile, thirdRoll > 0.975 ? "fallen-log" : "mushroom", thirdRoll, 0.34, 0.52, occupiedFootprints, cols, rows);
    }
  }
  return details;
}

function grassDetailKind(baseRoll, thirdRoll) {
  if (thirdRoll > 0.78) return "flower";
  if (baseRoll > 0.86 && thirdRoll < 0.28) return "mushroom";
  return "tuft";
}
