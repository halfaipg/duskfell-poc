import {
  courtyardMetrics,
  gatehouseMetrics,
  leywellMetrics,
  stormrootMetrics,
  viaductMetrics,
} from "./terrain-composition-kit-metrics.js";

export function materialForCompositionKit(x, y, material, biome, compositionKits) {
  if (material === "water") return material;
  const viaduct = compositionKits.find((kit) => kit.kind === "ancient-viaduct");
  const courtyard = compositionKits.find((kit) => kit.kind === "sunken-courtyard");
  const gatehouse = compositionKits.find((kit) => kit.kind === "gatehouse-ruin");
  const stormroot = compositionKits.find((kit) => kit.kind === "stormroot-ruin");
  const leywell = compositionKits.find((kit) => kit.kind === "leywell-garden");
  if (leywell) {
    const metrics = leywellMetrics(x, y, leywell);
    if (metrics.inBasin) return "ruin";
    if (metrics.onConduit) return "field";
    if (metrics.inFallenRim) return "rock";
    if (metrics.inWetGarden && biome.plazaPressure < 0.16 && (material === "grass" || material === "dirt")) return "shore";
  }
  if (stormroot) {
    const metrics = stormrootMetrics(x, y, stormroot);
    if (metrics.inChargedCore || metrics.onWireScar) return "field";
    if (metrics.inRotRing && biome.plazaPressure < 0.16 && material === "grass") return "dirt";
  }
  if (courtyard) {
    const metrics = courtyardMetrics(x, y, courtyard);
    if (metrics.onWall || metrics.onStairs) return "ruin";
    if (metrics.inFloor) return "cobble";
    if (metrics.inRubble && biome.plazaPressure < 0.12) return "rock";
  }
  if (gatehouse) {
    const metrics = gatehouseMetrics(x, y, gatehouse);
    if (metrics.inThreshold) return "field";
    if (metrics.inPassage || metrics.onTower) return "ruin";
    if (metrics.inRubble) return "rock";
  }
  if (!viaduct) return material;
  const metrics = viaductMetrics(x, y, viaduct);
  if (metrics.onCauseway) return "cobble";
  if (metrics.inRubble && biome.plazaPressure < 0.12 && material === "grass") return "rock";
  return material;
}
