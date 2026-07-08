import { clamp, hash01 } from "./terrain-primitives.js";

export function detailMetadata(tile, profile, kind, seed, options = {}) {
  if (kind !== "tree") {
    return nonTreeMetadata(tile, profile, kind, seed);
  }

  const stageRoll = hash01(tile.x, tile.y, profile.seed + seed + 67);
  const authoredStage = {
    "ancient-canopy": "ancient",
    "mature-canopy": "mature",
    "young-edge": "sapling",
  }[options.kitRole];
  const authoredVariant = {
    "ancient-canopy": 0,
    "mature-canopy": 1,
    "young-edge": 2,
  }[options.kitRole];
  const stage = authoredStage ?? (stageRoll < 0.28 ? "sapling" : stageRoll < 0.62 ? "mature" : "ancient");
  const variant = authoredVariant ?? Math.floor(hash01(tile.x, tile.y, profile.seed + seed + 71) * 4);
  const species = ["greenwood", "shadebark", "ironleaf", "paleoak"][variant] ?? "greenwood";
  const vigor = hash01(tile.x, tile.y, profile.seed + seed + 75);
  const ageYears = treeAgeYears(stage, vigor, hash01(tile.x, tile.y, profile.seed + seed + 77));
  const decay = treeDecayFor(stage, species, vigor, hash01(tile.x, tile.y, profile.seed + seed + 81));
  const health = clamp(1 - decay * 0.7 + (vigor - 0.5) * 0.16, 0.18, 1);
  const stageConfig = {
    sapling: { min: 1, max: 3, scale: [0.72, 0.78, 0.68, 0.74][variant], vertical: 0.62, radius: 0.5, fade: 0.72, sort: 4 },
    mature: { min: 4, max: 9, scale: [1, 1.06, 0.94, 1.02][variant], vertical: 1.08, radius: 0.78, fade: 0.56, sort: 10 },
    ancient: { min: 8, max: 14, scale: [1.15, 1.2, 1.08, 1.16][variant], vertical: 1.46, radius: 0.96, fade: 0.46, sort: 15 },
  }[stage];
  const resourceRoll = hash01(tile.x, tile.y, profile.seed + seed + 83);
  const healthAdjustedMax = Math.max(stageConfig.min, Math.round(stageConfig.max * (0.58 + health * 0.42)));
  const amount = clampInteger(
    stageConfig.min + Math.floor(resourceRoll * (healthAdjustedMax - stageConfig.min + 1)),
    1,
    stageConfig.max,
  );
  const seedAmount =
    health > 0.42 && (stage === "ancient" || (stage === "mature" && resourceRoll > 0.58) || (stage === "sapling" && vigor > 0.92))
      ? 1
      : 0;
  return {
    stage,
    variant,
    species,
    ageYears,
    health,
    scaleMultiplier: stageConfig.scale,
    lifecycle: {
      stage,
      species,
      ageYears,
      health,
      decay,
      growth: stage === "sapling" ? 0.28 : stage === "mature" ? 0.72 : 1,
    },
    vertical: stageConfig.vertical * stageConfig.scale,
    occlusion: {
      heightTiles: stageConfig.vertical * stageConfig.scale,
      radiusTiles: stageConfig.radius * (0.94 + stageConfig.scale * 0.08),
      fadeAlpha: clamp(stageConfig.fade + (1 - health) * 0.08, 0.42, 0.82),
    },
    sortBias: stageConfig.sort,
    resources: [
      {
        kind: "wood",
        amount,
        maxAmount: stageConfig.max,
      },
      ...(seedAmount > 0 ? [{ kind: "seed", amount: seedAmount, maxAmount: 1 }] : []),
    ],
  };
}

function nonTreeMetadata(tile, profile, kind, seed) {
  if (kind === "boulder") {
    const amount = 1 + Math.floor(hash01(tile.x, tile.y, profile.seed + seed + 73) * 4);
    return {
      resources: [{ kind: "ore", amount, maxAmount: 4 }],
      lifecycle: { stage: "mineral", decay: 0, growth: 0 },
    };
  }
  if (kind === "ruin") {
    const ageYears = 42000 + Math.floor(hash01(tile.x, tile.y, profile.seed + seed + 74) * 110000);
    const decay = 0.48 + hash01(tile.x, tile.y, profile.seed + seed + 76) * 0.42;
    const amount = 1 + Math.floor((1 - decay * 0.55) * 5);
    return {
      resources: [{ kind: "stone", amount, maxAmount: 6 }],
      lifecycle: {
        family: "mineral",
        stage: "ancient-ruin",
        species: "weathered-viaduct-stone",
        ageYears,
        health: clamp(1 - decay * 0.86, 0.08, 0.48),
        decay,
        growth: 0,
      },
      occlusion: {
        heightTiles: 0.72,
        radiusTiles: 0.82,
        fadeAlpha: 0.54,
      },
    };
  }
  if (kind === "wall" || kind === "stairs" || kind === "foundation") {
    return masonryMetadata(tile, profile, kind, seed);
  }
  if (kind === "reeds") {
    const amount = 1 + Math.floor(hash01(tile.x, tile.y, profile.seed + seed + 79) * 3);
    return {
      resources: [{ kind: "fiber", amount, maxAmount: 3 }],
      lifecycle: { stage: "living", decay: 0, growth: 0.72 },
    };
  }
  if (kind === "fallen-log" || kind === "stump") {
    const decay = hash01(tile.x, tile.y, profile.seed + seed + 89);
    const amount = 1 + Math.floor((1 - decay * 0.48) * 3);
    return {
      lifecycle: { stage: decay > 0.62 ? "decaying" : "deadwood", decay, growth: 0 },
      resources: [
        { kind: "deadwood", amount, maxAmount: 4 },
        ...(decay > 0.58 ? [{ kind: "spores", amount: 1, maxAmount: 2 }] : []),
      ],
    };
  }
  if (kind === "mushroom") {
    const decay = 0.45 + hash01(tile.x, tile.y, profile.seed + seed + 97) * 0.55;
    const amount = 1 + Math.floor(decay * 3);
    return {
      lifecycle: { stage: "fruiting", decay, growth: decay },
      consumes: [{ kind: "deadwood", amount: 1 }],
      resources: [{ kind: "mycelium", amount, maxAmount: 4 }],
    };
  }
  return {};
}

function masonryMetadata(tile, profile, kind, seed) {
  const ageYears = 70000 + Math.floor(hash01(tile.x, tile.y, profile.seed + seed + 78) * 90000);
  const decay =
    kind === "foundation"
      ? 0.55 + hash01(tile.x, tile.y, profile.seed + seed + 82) * 0.35
      : 0.42 + hash01(tile.x, tile.y, profile.seed + seed + 82) * 0.44;
  const amount = kind === "wall" ? 3 : kind === "stairs" ? 2 : 1;
  return {
    resources: [{ kind: "stone", amount, maxAmount: kind === "wall" ? 8 : 5 }],
    lifecycle: {
      family: "mineral",
      stage: kind === "stairs" ? "eroded-stairs" : kind === "foundation" ? "sunken-foundation" : "broken-wall",
      species: "weathered-courtyard-stone",
      ageYears,
      health: clamp(1 - decay * 0.78, 0.1, 0.54),
      decay,
      growth: 0,
    },
    vertical: kind === "wall" ? 1.4 : kind === "stairs" ? 0.7 : 0.18,
    occlusion:
      kind === "wall"
        ? { heightTiles: 1.28, radiusTiles: 0.72, fadeAlpha: 0.42 }
        : kind === "stairs"
          ? { heightTiles: 0.54, radiusTiles: 0.68, fadeAlpha: 0.62 }
          : { heightTiles: 0.18, radiusTiles: 0.54, fadeAlpha: 0.78 },
    sortBias: kind === "wall" ? 16 : kind === "stairs" ? 6 : -2,
  };
}

function treeAgeYears(stage, vigor, roll) {
  const ranges = {
    sapling: [2, 11],
    mature: [18, 76],
    ancient: [95, 260],
  }[stage];
  return Math.round(ranges[0] + (ranges[1] - ranges[0]) * (roll * 0.74 + vigor * 0.26));
}

function treeDecayFor(stage, species, vigor, roll) {
  const ageBias = stage === "ancient" ? 0.2 : stage === "mature" ? 0.08 : 0.02;
  const speciesBias = species === "ironleaf" ? 0.1 : species === "paleoak" ? 0.06 : 0;
  return clamp(ageBias + speciesBias + roll * (1 - vigor) * 0.42, 0, stage === "sapling" ? 0.24 : 0.72);
}

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
