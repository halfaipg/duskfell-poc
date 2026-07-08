import { hash01, hashUnit } from "./terrain-primitives.js";

export function decalsForTile(x, y, material, profile, biome, composition = null) {
  if (material === "water" || material === "settlement") return [];
  const detailBudget = composition?.detailBudget ?? biome.detailDensity ?? 0.5;
  const openSpace = composition?.openSpace ?? 0;
  const quietRoll = hash01(x, y, profile.seed + 41);
  if (!composition?.kitId && openSpace > 0.44 && quietRoll < 0.54 + openSpace * 0.34) return [];
  if (!composition?.kitId && detailBudget < 0.18 && quietRoll < 0.48) return [];
  const amount =
    detailBudget > 0.66 && openSpace < 0.34 && Math.abs(hashUnit(x, y, profile.seed + 17)) > 0.52 ? 2 : 1;
  const decals = [];
  for (let index = 0; index < amount; index += 1) {
    const seed = index + 1;
    const u = 0.22 + Math.abs(hashUnit(x, y, profile.seed + seed)) * 0.56;
    const v = 0.2 + Math.abs(hashUnit(x, y, profile.seed + seed + 11)) * 0.58;
    const variant = hashUnit(x, y, profile.seed + seed + 23);
    decals.push({
      kind: biome.rockiness > 0.58 || material === "stone" || variant > 0.48 ? "pebble" : "tuft",
      u,
      v,
      size: 2 + Math.floor(Math.abs(hashUnit(x, y, profile.seed + seed + 31)) * 4),
    });
  }
  if (composition?.kitKind === "ancient-viaduct") {
    const extra = composition.kitRole === "causeway" ? 3 : 2;
    for (let index = 0; index < extra; index += 1) {
      const seed = 41 + index;
      const roll = hash01(x, y, profile.seed + seed);
      decals.push({
        kind: index === 0 && composition.kitRole === "causeway" ? "crack" : roll > 0.58 ? "moss" : "pebble",
        u: 0.18 + hash01(x, y, profile.seed + seed + 3) * 0.64,
        v: 0.18 + hash01(x, y, profile.seed + seed + 7) * 0.64,
        size: 3 + Math.floor(hash01(x, y, profile.seed + seed + 13) * 5),
      });
    }
  }
  if (composition?.kitKind === "sunken-courtyard") {
    const extra = composition.kitRole === "courtyard-floor" ? 3 : 2;
    for (let index = 0; index < extra; index += 1) {
      const seed = 71 + index;
      const roll = hash01(x, y, profile.seed + seed);
      decals.push({
        kind: composition.kitRole === "courtyard-floor" && index === 0 ? "masonry-joint" : roll > 0.62 ? "crack" : "moss",
        u: 0.14 + hash01(x, y, profile.seed + seed + 5) * 0.72,
        v: 0.14 + hash01(x, y, profile.seed + seed + 9) * 0.72,
        size: 3 + Math.floor(hash01(x, y, profile.seed + seed + 17) * 5),
      });
    }
  }
  return decals;
}
