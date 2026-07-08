import {
  courtyardMetrics,
  gatehouseMetrics,
  leywellMetrics,
  stormrootMetrics,
  viaductMetrics,
} from "./terrain-composition-kit-metrics.js";

export function compositionKitMembership(x, y, compositionKits, zone, biome) {
  const memberships = [];
  for (const kit of compositionKits) {
    if (kit.kind === "ancient-viaduct") {
      const metrics = viaductMetrics(x, y, kit);
      if (metrics.onCauseway) memberships.push({ ...kit, role: "causeway", score: 1.2 });
      else if (metrics.inRubble) memberships.push({ ...kit, role: "rubble", score: 0.8 });
      continue;
    }
    if (kit.kind === "sunken-courtyard") {
      const metrics = courtyardMetrics(x, y, kit);
      if (metrics.onStairs) memberships.push({ ...kit, role: "stairs", score: 1.32 });
      else if (metrics.onWall) memberships.push({ ...kit, role: metrics.wallRole, score: 1.24 });
      else if (metrics.inFloor) memberships.push({ ...kit, role: "courtyard-floor", score: 0.94 });
      else if (metrics.inRubble) memberships.push({ ...kit, role: "courtyard-rubble", score: 0.74 });
      continue;
    }
    if (kit.kind === "gatehouse-ruin") {
      const metrics = gatehouseMetrics(x, y, kit);
      if (metrics.inThreshold) memberships.push({ ...kit, role: "threshold", score: 1.26 });
      else if (metrics.inPassage) memberships.push({ ...kit, role: "passage", score: 1.14 });
      else if (metrics.onTower) memberships.push({ ...kit, role: metrics.towerRole, score: 1.08 });
      else if (metrics.inRubble) memberships.push({ ...kit, role: "rubble", score: 0.7 });
      continue;
    }
    if (kit.kind === "stormroot-ruin") {
      const metrics = stormrootMetrics(x, y, kit);
      if (metrics.inChargedCore) memberships.push({ ...kit, role: "charged-core", score: 1.18 });
      else if (metrics.onWireScar) memberships.push({ ...kit, role: "wire-scar", score: 1.08 });
      else if (metrics.inRotRing) memberships.push({ ...kit, role: "rot-ring", score: 0.82 });
      else if (metrics.inOuterRoot) memberships.push({ ...kit, role: "outer-root", score: 0.62 });
      continue;
    }
    if (kit.kind === "leywell-garden") {
      const metrics = leywellMetrics(x, y, kit);
      if (metrics.inBasin) memberships.push({ ...kit, role: "basin", score: 1.16 });
      else if (metrics.onConduit) memberships.push({ ...kit, role: "conduit", score: 1.04 });
      else if (metrics.inWetGarden) memberships.push({ ...kit, role: "wet-garden", score: 0.82 });
      else if (metrics.inFallenRim) memberships.push({ ...kit, role: "fallen-rim", score: 0.66 });
      continue;
    }
    const distance = Math.hypot(x + 0.5 - kit.x, y + 0.5 - kit.y);
    if (distance > kit.radius) continue;
    let role = "edge";
    if (kit.kind === "settlement-core") role = zone === "plaza" ? "plaza" : zone === "road" ? "road" : "threshold";
    if (kit.kind === "old-grove") role = biome?.vegetation > 0.62 ? "canopy" : "understory";
    if (kit.kind === "river-reedbed") role = zone === "shore" ? "reedline" : "wet-edge";
    memberships.push({ ...kit, role, score: 1 - distance / kit.radius });
  }
  memberships.sort((a, b) => b.priority - a.priority || b.score - a.score);
  return memberships[0] ?? null;
}
