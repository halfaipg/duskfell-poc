export const ECOLOGY_FEED_LINK_RADIUS = 112;
export const COIL_MYCELIUM_LINK_RADIUS = 140;

export function ecologyFeedLinks(objects, radius = ECOLOGY_FEED_LINK_RADIUS) {
  if (!Array.isArray(objects) || radius <= 0) return [];

  const deadwood = objects.filter(isFeedSource);
  const mycelium = objects.filter(isFeedTarget);
  const links = [];

  for (const source of deadwood) {
    for (const target of mycelium) {
      const distance = worldDistance(source, target);
      if (distance > radius) continue;
      const targetFullness = resourceFullness(target);
      const sourceFullness = resourceFullness(source);
      const decay = clamp01(source.lifecycle?.decay ?? 0.5);
      const hunger = 1 - targetFullness;
      links.push({
        source,
        target,
        distance,
        strength: clamp01((1 - distance / radius) * 0.42 + decay * 0.32 + hunger * 0.26),
        sourceFullness,
        targetFullness,
        decay,
        hunger,
      });
    }
  }

  return links.sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength;
    return String(a.source.id).localeCompare(String(b.source.id)) || String(a.target.id).localeCompare(String(b.target.id));
  });
}

export function coilMyceliumLinks(objects, radius = COIL_MYCELIUM_LINK_RADIUS) {
  if (!Array.isArray(objects) || radius <= 0) return [];

  const coils = objects.filter(isCoilSource);
  const mycelium = objects.filter((object) => object?.kind === "myceliumPatch");
  const links = [];

  for (const source of coils) {
    for (const target of mycelium) {
      const distance = worldDistance(source, target);
      if (distance > radius) continue;
      const chargeFullness = resourceFullness(source);
      const targetFullness = resourceFullness(target);
      const hunger = 1 - targetFullness;
      links.push({
        source,
        target,
        distance,
        strength: clamp01((1 - distance / radius) * 0.34 + chargeFullness * 0.48 + hunger * 0.18),
        chargeFullness,
        targetFullness,
        hunger,
        spent: chargeFullness <= 0,
      });
    }
  }

  return links.sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength;
    return String(a.source.id).localeCompare(String(b.source.id)) || String(a.target.id).localeCompare(String(b.target.id));
  });
}

function isFeedSource(object) {
  return object?.kind === "deadwood" && resourceAmount(object, "deadwood") > 0;
}

function isFeedTarget(object) {
  return object?.kind === "myceliumPatch" && resourceAmount(object, "mycelium") >= 0;
}

function isCoilSource(object) {
  return object?.kind === "fieldCoil" && resourceAmount(object, "charge") >= 0;
}

function resourceAmount(object, kind) {
  return object?.resources?.find((resource) => resource.kind === kind)?.amount ?? 0;
}

function resourceFullness(object) {
  const resource = object?.resources?.[0];
  if (!resource || resource.maxAmount <= 0) return 0;
  return clamp01(resource.amount / resource.maxAmount);
}

function worldDistance(a, b) {
  return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
