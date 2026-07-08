export const ECOLOGY_GROUND_EFFECT_LIMIT = 96;

export function ecologyGroundEffects(objects, options = {}) {
  if (!Array.isArray(objects)) return [];
  const limit = options.limit ?? ECOLOGY_GROUND_EFFECT_LIMIT;
  const pressures = pressureMap(options.pressures);
  const effects = [];

  for (const object of objects) {
    if (effects.length >= limit) break;
    const effect = ecologyGroundEffect(object, pressures.get(object?.id));
    if (effect) effects.push(effect);
  }

  return effects.sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return String(a.id).localeCompare(String(b.id));
  });
}

function ecologyGroundEffect(object, pressure = null) {
  if (!object || !Number.isFinite(object.x) || !Number.isFinite(object.y)) return null;
  const fullness = resourceFullness(object);
  const decay = clamp01(object.lifecycle?.decay ?? 0);
  const health = clamp01(object.lifecycle?.health ?? fullness);
  const family = object.lifecycle?.family;

  if (family === "tree" || object.kind === "saplingTree" || object.kind === "grove") {
    const growth = clamp01(object.lifecycle?.growth ?? fullness);
    const age = Number.isFinite(object.lifecycle?.ageYears) ? object.lifecycle.ageYears : 0;
    const agePressure = clamp01(age / 240);
    return {
      id: object.id,
      kind: "tree-litter",
      x: object.x,
      y: object.y,
      radius: 18 + growth * 30 + agePressure * 18,
      intensity: clamp01(0.14 + growth * 0.22 + agePressure * 0.26 + (1 - health) * 0.18),
      growth,
      health,
      agePressure,
      decay,
    };
  }

  if (object.kind === "deadwood") {
    return {
      id: object.id,
      kind: "rot",
      x: object.x,
      y: object.y,
      radius: 18 + decay * 26 + fullness * 8,
      intensity: clamp01(0.26 + decay * 0.5 + fullness * 0.16),
      fullness,
      decay,
    };
  }

  if (object.kind === "myceliumPatch") {
    const hunger = 1 - fullness;
    const feedStrength = clamp01(pressure?.feedStrength ?? 0);
    const chargeStrength = clamp01(pressure?.chargeStrength ?? 0);
    return {
      id: object.id,
      kind: "mycelium",
      x: object.x,
      y: object.y,
      radius: 20 + fullness * 34 + health * 8 + feedStrength * 10 + chargeStrength * 6,
      intensity: clamp01(0.24 + fullness * 0.46 + hunger * 0.12 + feedStrength * 0.18 + chargeStrength * 0.12),
      fullness,
      hunger,
      feedStrength,
      chargeStrength,
      feedSources: pressure?.feedSources ?? 0,
      chargeSources: pressure?.chargeSources ?? 0,
      state: pressure?.state ?? (hunger > 0.55 ? "seeking" : "fruiting"),
    };
  }

  if (object.kind === "fieldCoil") {
    return {
      id: object.id,
      kind: "charge",
      x: object.x,
      y: object.y,
      radius: 22 + fullness * 24,
      intensity: clamp01(0.18 + fullness * 0.55),
      fullness,
      spent: fullness <= 0,
    };
  }

  if (object.kind === "ruin") {
    return {
      id: object.id,
      kind: "mineral-decay",
      x: object.x,
      y: object.y,
      radius: 20 + decay * 22 + (1 - health) * 12,
      intensity: clamp01(0.16 + decay * 0.35),
      decay,
      health,
    };
  }

  if (family === "mineral" || object.kind === "ore") {
    const age = Number.isFinite(object.lifecycle?.ageYears) ? object.lifecycle.ageYears : 0;
    const agePressure = clamp01(age / 160000);
    return {
      id: object.id,
      kind: "mineral-dust",
      x: object.x,
      y: object.y,
      radius: 16 + fullness * 14 + agePressure * 18,
      intensity: clamp01(0.1 + agePressure * 0.26 + (1 - health) * 0.18),
      agePressure,
      health,
    };
  }

  return null;
}

function pressureMap(pressures) {
  if (pressures instanceof Map) return pressures;
  if (!Array.isArray(pressures)) return new Map();
  return new Map(
    pressures
      .filter((pressure) => typeof pressure?.object?.id === "string" || typeof pressure?.id === "string")
      .map((pressure) => [pressure.object?.id ?? pressure.id, pressure]),
  );
}

function resourceFullness(object) {
  const resource = object?.resources?.[0];
  if (!resource || resource.maxAmount <= 0) return 0;
  return clamp01(resource.amount / resource.maxAmount);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
