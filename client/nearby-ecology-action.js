import { ecologyObjectPressures } from "./ecology-links.js";

export function nearestEcologyAction(objects, playerPosition, options = {}) {
  if (!Array.isArray(objects) || !playerPosition) return null;
  const radius = options.radius ?? 155;
  const pressures = options.pressures ?? ecologyObjectPressures(objects, options.pressureOptions ?? {});
  let nearest = null;
  let nearestDistanceSquared = radius * radius;

  for (const object of objects) {
    const action = ecologyActionForObject(object, pressures);
    if (!action) continue;
    const currentDistanceSquared = distanceSquared(object, playerPosition);
    if (currentDistanceSquared > nearestDistanceSquared) continue;
    nearest = {
      ...action,
      object,
      id: object.id,
      kind: object.kind,
      distanceSquared: currentDistanceSquared,
    };
    nearestDistanceSquared = currentDistanceSquared;
  }

  return nearest;
}

export function ecologyActionForObject(object, pressures = new Map()) {
  if (!object || typeof object.kind !== "string") return null;
  if (object.kind === "deadwood") return deadwoodAction(object);
  if (object.kind === "myceliumPatch") return myceliumAction(object, pressures?.get?.(object.id));
  if (object.kind === "saplingTree") return treeAction(object);
  if (object.kind === "ruin") return ruinAction(object);
  if (object.kind === "fieldCoil") return fieldCoilAction(object);
  return null;
}

function deadwoodAction(object) {
  const deadwood = resource(object, "deadwood");
  if (!hasAmount(deadwood)) return null;
  const decay = clamp01(object.lifecycle?.decay ?? 0);
  const state = decay > 0.68 ? "soft rot" : decay > 0.36 ? "weathering" : "dry";
  return {
    label: `Deadwood: ${state}`,
    action: "Gather deadwood",
    tone: decay > 0.58 ? "decay" : "resource",
  };
}

function myceliumAction(object, pressure) {
  const mycelium = resource(object, "mycelium");
  if (!mycelium) return null;
  const fullness = resourceFullness(mycelium);
  const state = pressure?.state ?? (fullness < 0.3 ? "dormant" : fullness > 0.78 ? "blooming" : "fruiting");
  const labelState = {
    "charged-hungry": "charged and hungry",
    charged: "charged",
    feeding: "feeding",
    seeking: "hungry",
    dormant: "dormant",
    fruiting: "fruiting",
    blooming: "blooming",
  }[state] ?? state;
  return {
    label: `Mycelium: ${labelState}`,
    action: fullness < 0.92 ? "Feed mycelium" : "Harvest mycelium",
    tone: state.includes("charged") ? "charge" : state === "feeding" || state === "seeking" ? "decay" : "growth",
  };
}

function treeAction(object) {
  const wood = resource(object, "wood");
  if (!hasAmount(wood)) return null;
  const stage = object.lifecycle?.stage ?? "growing";
  const species = speciesLabel(object.lifecycle?.species);
  return {
    label: `${stageLabel(stage)}${species ? ` ${species}` : " tree"}`,
    action: "Gather wood",
    tone: stage === "sapling" ? "growth" : "resource",
  };
}

function ruinAction(object) {
  const stone = resource(object, "stone");
  if (!hasAmount(stone)) return null;
  const age = Number.isFinite(object.lifecycle?.ageYears) ? object.lifecycle.ageYears : 0;
  const decay = clamp01(object.lifecycle?.decay ?? 0);
  const label = age >= 100000 ? "Ancient ruin" : "Weathered ruin";
  return {
    label: `${label}: ${decay > 0.7 ? "crumbling" : "stable"}`,
    action: "Gather stone",
    tone: "mineral",
  };
}

function fieldCoilAction(object) {
  const charge = resource(object, "charge");
  if (!charge) return null;
  const fullness = resourceFullness(charge);
  return {
    label: `Field coil: ${fullness > 0.1 ? "charged" : "spent"}`,
    action: fullness > 0.1 ? "Draw charge" : "Inspect coil",
    tone: fullness > 0.1 ? "charge" : "mineral",
  };
}

function resource(object, kind) {
  return object?.resources?.find?.((candidate) => candidate.kind === kind) ?? null;
}

function hasAmount(resource) {
  return Boolean(resource && resource.amount > 0);
}

function resourceFullness(resource) {
  if (!resource || resource.maxAmount <= 0) return 0;
  return clamp01(resource.amount / resource.maxAmount);
}

function stageLabel(stage) {
  if (stage === "sapling") return "Sapling";
  if (stage === "mature") return "Mature";
  if (stage === "ancient") return "Ancient";
  return "Tree";
}

function speciesLabel(species) {
  return {
    greenwood: "greenwood",
    shadebark: "shadebark",
    ironleaf: "ironleaf",
    paleoak: "pale oak",
  }[species] ?? "";
}

function distanceSquared(a, b) {
  const dx = (a.x ?? 0) - (b.x ?? 0);
  const dy = (a.y ?? 0) - (b.y ?? 0);
  return dx * dx + dy * dy;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
