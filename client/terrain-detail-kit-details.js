import { leywellGardenKitDetails, oldGroveKitDetails, riverReedbedKitDetails, stormrootKitDetails } from "./terrain-detail-nature-kits.js";
import { ancientViaductKitDetails, courtyardKitDetails, gatehouseKitDetails } from "./terrain-detail-ruin-kits.js";

export function compositionKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints) {
  if (kit.kind === "sunken-courtyard") {
    return courtyardKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints);
  }
  if (kit.kind === "gatehouse-ruin") {
    return gatehouseKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints);
  }
  if (kit.kind === "stormroot-ruin") {
    return stormrootKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints);
  }
  if (kit.kind === "leywell-garden") {
    return leywellGardenKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints);
  }
  if (kit.kind === "old-grove") {
    return oldGroveKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints);
  }
  if (kit.kind === "river-reedbed") {
    return riverReedbedKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints);
  }
  if (kit.kind === "ancient-viaduct") {
    return ancientViaductKitDetails(kit, tilesByCoord, cols, rows, profile, occupiedFootprints);
  }
  return [];
}
