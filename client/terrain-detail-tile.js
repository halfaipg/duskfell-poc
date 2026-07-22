import { hash01 } from "./terrain-primitives.js";
import { tryAddDetail } from "./terrain-detail-placement-utils.js";

export function detailsForTile(tile, cols, rows, safeRadiusTiles, profile, occupiedFootprints) {
  if (tile.material === "water" || tile.material === "settlement") return [];
  if (tile.composition?.kitId) return [];

  const centerDistance = Math.hypot(tile.x + 0.5 - cols / 2, tile.y + 0.5 - rows / 2);
  if (centerDistance < safeRadiusTiles * 1.28) return [];

  const habitat = tile.composition?.habitat;
  if (!habitat || habitat.band === "open" || habitat.clearance > 0.58) return [];
  if ((tile.composition?.openSpace ?? 0) > 0.68 && habitat.band !== "core") return [];

  const details = [];
  const rolls = {
    primary: hash01(tile.x, tile.y, profile.seed + 701),
    secondary: hash01(tile.x, tile.y, profile.seed + 809),
    accent: hash01(tile.x, tile.y, profile.seed + 907),
  };
  const strength = habitat.strength;
  const density = tile.composition?.detailBudget ?? tile.biome?.detailDensity ?? 0.5;
  const coreBonus = habitat.band === "core" ? 0.08 : 0;
  const add = (kind, roll, minScale, maxScale) =>
    tryAddDetail(details, tile, profile, kind, roll, minScale, maxScale, occupiedFootprints, cols, rows);

  if (habitat.kind === "woodland") {
    if (rolls.primary > 0.91 - strength * 0.2 - coreBonus) {
      add("tree", rolls.primary, 0.7, 1.02);
    }
    if (rolls.secondary > 0.985 - strength * 0.07 - coreBonus * 0.25) {
      add("scrub", rolls.secondary, 0.42, 0.72);
    }
    if (rolls.accent > 0.95 - density * 0.08) {
      add(rolls.accent > 0.985 ? "flower" : "tuft", rolls.accent, 0.28, 0.48);
    }
    return details;
  }

  if (habitat.kind === "wetland") {
    if (rolls.primary > 0.88 - strength * 0.16 - coreBonus) {
      add("reeds", rolls.primary, 0.42, 0.72);
    }
    if (rolls.secondary > 0.95 - strength * 0.08) {
      add("tuft", rolls.secondary, 0.26, 0.44);
    }
    if (rolls.accent > 0.975 - density * 0.06) {
      add(rolls.accent > 0.987 ? "fallen-log" : "pebble", rolls.accent, 0.24, 0.46);
    }
    return details;
  }

  if (habitat.kind === "rocky") {
    if (rolls.primary > 0.985 - strength * 0.04 - coreBonus * 0.18) {
      add(rolls.primary > 0.995 ? "boulder" : "rock", rolls.primary, 0.34, 0.62);
    }
    if (rolls.secondary > 0.992 - density * 0.03) {
      add("pebble", rolls.secondary, 0.18, 0.32);
    }
    if (rolls.accent > 0.987 - (tile.biome?.vegetation ?? 0) * 0.04) {
      add("tuft", rolls.accent, 0.24, 0.4);
    }
    return details;
  }

  if (habitat.kind === "scrub") {
    if (rolls.primary > 0.9 - strength * 0.15 - coreBonus) {
      add("scrub", rolls.primary, 0.4, 0.7);
    }
    if (rolls.secondary > 0.94 - density * 0.08) {
      add(rolls.secondary > 0.985 ? "stump" : "tuft", rolls.secondary, 0.28, 0.48);
    }
    if (rolls.accent > 0.976 - (tile.biome?.rockiness ?? 0) * 0.06) {
      add("rock", rolls.accent, 0.26, 0.46);
    }
  }

  return details;
}
