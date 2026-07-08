export const ECOLOGY_FEED_LINK_RADIUS = 112;
export const COIL_MYCELIUM_LINK_RADIUS = 140;
const TERRAIN_DETAIL_OBJECT_PREFIX = "terrain-detail:";
const decayConsumerRuleCache = new WeakMap();

export function ecologyFeedLinks(objects, radius = ECOLOGY_FEED_LINK_RADIUS, options = {}) {
  if (!Array.isArray(objects) || radius <= 0) return [];

  const decayConsumerRules = options.decayConsumerRules ?? null;
  const deadwood = objects.filter(isFeedSource);
  const mycelium = objects.filter(isFeedTarget);
  const links = [];

  for (const source of deadwood) {
    for (const target of mycelium) {
      const distance = worldDistance(source, target);
      if (distance > radius) continue;
      const recipe = decayConsumerRecipeForTarget(decayConsumerRules, target, source);
      if (!recipe.accepts) continue;
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
        consumeKind: recipe.kind,
        consumeAmount: recipe.amount,
        authoredRecipe: recipe.authored,
      });
    }
  }

  return links.sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength;
    return String(a.source.id).localeCompare(String(b.source.id)) || String(a.target.id).localeCompare(String(b.target.id));
  });
}

export function terrainDecayConsumerRules(detailAuthority) {
  if (detailAuthority && decayConsumerRuleCache.has(detailAuthority)) {
    return decayConsumerRuleCache.get(detailAuthority);
  }
  const rules = new Map();
  const consumers = detailAuthority?.decayConsumers;
  if (!Array.isArray(consumers)) return rules;
  for (const consumer of consumers) {
    if (typeof consumer?.id !== "string" || !Array.isArray(consumer.consumes)) continue;
    const requirements = consumer.consumes
      .filter((requirement) => typeof requirement?.kind === "string" && requirement.amount > 0)
      .map((requirement) => ({
        kind: requirement.kind,
        amount: requirement.amount,
      }));
    if (requirements.length === 0) continue;
    rules.set(`${TERRAIN_DETAIL_OBJECT_PREFIX}${consumer.id}`, requirements);
  }
  if (detailAuthority && typeof detailAuthority === "object") {
    decayConsumerRuleCache.set(detailAuthority, rules);
  }
  return rules;
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

export function ecologyObjectPressures(objects, options = {}) {
  if (!Array.isArray(objects)) return new Map();
  const decayConsumerRules = options.decayConsumerRules ?? null;
  const feedRadius = options.feedRadius ?? ECOLOGY_FEED_LINK_RADIUS;
  const chargeRadius = options.chargeRadius ?? COIL_MYCELIUM_LINK_RADIUS;
  const feedLinks =
    options.feedLinks ?? ecologyFeedLinks(objects, feedRadius, { decayConsumerRules });
  const chargeLinks = options.chargeLinks ?? coilMyceliumLinks(objects, chargeRadius);
  const pressures = new Map();

  for (const object of objects) {
    if (object?.kind !== "myceliumPatch") continue;
    const fullness = resourceFullness(object);
    pressures.set(object.id, {
      object,
      fullness,
      hunger: 1 - fullness,
      feedStrength: 0,
      feedSources: 0,
      chargeStrength: 0,
      chargeSources: 0,
      state: fullness < 0.3 ? "dormant" : fullness < 0.8 ? "fruiting" : "blooming",
    });
  }

  for (const link of feedLinks) {
    const pressure = pressures.get(link.target?.id);
    if (!pressure) continue;
    pressure.feedStrength = Math.max(pressure.feedStrength, link.strength);
    pressure.feedSources += 1;
  }

  for (const link of chargeLinks) {
    const pressure = pressures.get(link.target?.id);
    if (!pressure) continue;
    pressure.chargeStrength = Math.max(pressure.chargeStrength, link.strength);
    pressure.chargeSources += 1;
  }

  for (const pressure of pressures.values()) {
    if (pressure.feedStrength > 0.05) {
      pressure.state = "feeding";
    } else if (pressure.chargeStrength > 0.08) {
      pressure.state = pressure.hunger > 0.45 ? "charged-hungry" : "charged";
    } else if (pressure.hunger > 0.55) {
      pressure.state = "seeking";
    }
  }

  return pressures;
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

function decayConsumerRecipeForTarget(decayConsumerRules, target, source) {
  const sourceResource = source?.resources?.[0]?.kind ?? "deadwood";
  const defaultRecipe = {
    accepts: true,
    kind: sourceResource,
    amount: 1,
    authored: false,
  };
  if (!decayConsumerRules?.has?.(target?.id)) return defaultRecipe;

  const requirements = decayConsumerRules.get(target.id) ?? [];
  const requirement = requirements.find((candidate) => candidate.kind === sourceResource);
  if (!requirement) {
    return {
      accepts: false,
      kind: sourceResource,
      amount: 0,
      authored: true,
    };
  }
  return {
    accepts: true,
    kind: requirement.kind,
    amount: requirement.amount,
    authored: true,
  };
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
