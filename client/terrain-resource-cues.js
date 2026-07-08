export const TERRAIN_RESOURCE_CUE_LIMIT = 4;

export function terrainResourceCues(detail, options = {}) {
  if (!detail || !Array.isArray(detail.resources)) return [];
  const limit = options.limit ?? TERRAIN_RESOURCE_CUE_LIMIT;
  const lifecycle = detail.lifecycle ?? {};
  const health = clamp01(lifecycle.health ?? detail.health ?? 1);
  const decay = clamp01(lifecycle.decay ?? 0);
  const growth = clamp01(lifecycle.growth ?? 0);
  const ageYears = Number.isFinite(lifecycle.ageYears) ? lifecycle.ageYears : Number.isFinite(detail.ageYears) ? detail.ageYears : 0;
  const cues = [];

  for (const resource of detail.resources) {
    if (cues.length >= limit) break;
    const cue = terrainResourceCue(resource, { detail, lifecycle, health, decay, growth, ageYears });
    if (cue) cues.push(cue);
  }

  return cues;
}

function terrainResourceCue(resource, context) {
  if (!resource || !Number.isFinite(resource.amount) || !Number.isFinite(resource.maxAmount) || resource.maxAmount <= 0) {
    return null;
  }
  if (resource.amount <= 0) return null;
  const fullness = clamp01(resource.amount / resource.maxAmount);
  const { detail, lifecycle, health, decay, growth, ageYears } = context;
  const agePressure = clamp01(ageYears / resourceAgePressure(resource.kind, lifecycle.family));
  const intensity = clamp01(0.18 + fullness * 0.34 + decay * 0.16 + agePressure * 0.14);
  const base = {
    resource: resource.kind,
    fullness,
    intensity,
    health,
    decay,
    agePressure,
  };

  if (resource.kind === "wood") {
    return {
      ...base,
      kind: "organic-ring",
      tone: treeTone(detail.species ?? lifecycle.species),
      radius: 7 + fullness * 5 + agePressure * 3,
    };
  }
  if (resource.kind === "seed") {
    return {
      ...base,
      kind: "seed",
      tone: "gold",
      count: Math.max(1, Math.min(3, resource.amount)),
    };
  }
  if (resource.kind === "fiber") {
    return {
      ...base,
      kind: "fiber",
      tone: "reed",
      count: 3 + Math.round(fullness * 3),
    };
  }
  if (resource.kind === "deadwood") {
    return {
      ...base,
      kind: "rot-feed",
      tone: decay > 0.58 ? "spore" : "bark",
      cracks: 2 + Math.round(fullness * 3),
    };
  }
  if (resource.kind === "spores") {
    return {
      ...base,
      kind: "spore",
      tone: "violet",
      count: Math.max(2, Math.min(5, resource.amount + 2)),
    };
  }
  if (resource.kind === "mycelium") {
    return {
      ...base,
      kind: "mycelium",
      tone: fullness < 0.7 ? "hungry" : "bloom",
      tendrils: 3 + Math.round(Math.max(fullness, growth) * 5),
    };
  }
  if (resource.kind === "charge") {
    return {
      ...base,
      kind: "charge",
      tone: fullness < 0.3 ? "spent" : "arc",
      arcs: 1 + Math.round(fullness * 3),
    };
  }
  if (resource.kind === "stone" || resource.kind === "ore") {
    return {
      ...base,
      kind: "mineral",
      tone: resource.kind === "ore" ? "ore" : "stone",
      chips: 2 + Math.round(fullness * 3),
    };
  }
  return null;
}

function treeTone(species) {
  return {
    greenwood: "green",
    shadebark: "deep",
    ironleaf: "iron",
    paleoak: "pale",
  }[species] ?? "green";
}

function resourceAgePressure(kind, family) {
  if (family === "mineral" || kind === "stone" || kind === "ore") return 160000;
  if (family === "deadwood" || kind === "deadwood" || kind === "spores") return 35;
  if (family === "mycelium" || kind === "mycelium") return 18;
  if (family === "machine" || kind === "charge") return 45;
  return 240;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
