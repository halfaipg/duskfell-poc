export const TERRAIN_FAMILY_ATLAS_ROLES = [
  "flat-base",
  "slope-texture",
  "edge-transition",
  "corner-transition",
  "elevation-lip",
  "worn-variant",
  "sparse-variant",
  "detail-decal",
];

export const TERRAIN_FAMILY_CATALOG = {
  "living-meadow": {
    id: "living-meadow",
    label: "Living Meadow",
    material: "grass",
    sourceTextureSize: 128,
    runtimeTileSize: 64,
    atlasRoles: TERRAIN_FAMILY_ATLAS_ROLES,
    detailKinds: ["tuft", "flower", "scrub", "mushroom"],
    resources: ["seed", "fiber"],
    lifecycle: {
      family: "organic",
      growthYears: [1, 12],
      decayYears: [2, 35],
    },
    neighborPolicy: {
      blendsWith: ["field", "dirt", "water"],
      transitionBias: "soft-grass-edge",
    },
  },
  "old-growth-woodland": {
    id: "old-growth-woodland",
    label: "Old Growth Woodland",
    material: "grass",
    sourceTextureSize: 128,
    runtimeTileSize: 64,
    atlasRoles: TERRAIN_FAMILY_ATLAS_ROLES,
    detailKinds: ["tree", "fallen-log", "stump", "mushroom", "scrub"],
    resources: ["wood", "seed", "deadwood", "spores", "mycelium"],
    lifecycle: {
      family: "organic",
      growthYears: [2, 260],
      decayYears: [3, 80],
    },
    neighborPolicy: {
      blendsWith: ["grass", "field", "dirt"],
      transitionBias: "rooted-understory",
    },
  },
  "charged-rotland": {
    id: "charged-rotland",
    label: "Charged Rotland",
    material: "field",
    sourceTextureSize: 128,
    runtimeTileSize: 64,
    atlasRoles: TERRAIN_FAMILY_ATLAS_ROLES,
    detailKinds: ["mushroom", "fallen-log", "stump", "ruin", "pebble"],
    resources: ["charge", "deadwood", "spores", "mycelium"],
    lifecycle: {
      family: "machine-organic",
      growthYears: [1, 45],
      decayYears: [4, 120],
    },
    neighborPolicy: {
      blendsWith: ["grass", "dirt", "stone"],
      transitionBias: "burn-scar-conduit",
    },
  },
  "scrub-path": {
    id: "scrub-path",
    label: "Scrub Path",
    material: "dirt",
    sourceTextureSize: 128,
    runtimeTileSize: 64,
    atlasRoles: TERRAIN_FAMILY_ATLAS_ROLES,
    detailKinds: ["pebble", "rock", "stump", "tuft"],
    resources: ["deadwood", "stone"],
    lifecycle: {
      family: "soil",
      growthYears: [2, 40],
      decayYears: [3, 60],
    },
    neighborPolicy: {
      blendsWith: ["grass", "field", "stone", "water"],
      transitionBias: "worn-path-edge",
    },
  },
  "ancient-stonework": {
    id: "ancient-stonework",
    label: "Ancient Stonework",
    material: "stone",
    sourceTextureSize: 128,
    runtimeTileSize: 64,
    atlasRoles: TERRAIN_FAMILY_ATLAS_ROLES,
    detailKinds: ["wall", "stairs", "foundation", "ruin", "boulder", "rock", "pebble"],
    resources: ["stone", "ore"],
    lifecycle: {
      family: "mineral",
      growthYears: [0, 0],
      decayYears: [40000, 160000],
    },
    neighborPolicy: {
      blendsWith: ["dirt", "grass", "field"],
      transitionBias: "cracked-masonry-lip",
    },
  },
  "broken-cobble": {
    id: "broken-cobble",
    label: "Broken Cobble",
    material: "cobble",
    sourceTextureSize: 128,
    runtimeTileSize: 64,
    atlasRoles: TERRAIN_FAMILY_ATLAS_ROLES,
    detailKinds: ["foundation", "pebble", "tuft", "moss"],
    resources: ["stone"],
    lifecycle: {
      family: "worked-surface",
      growthYears: [0, 0],
      decayYears: [300, 100000],
    },
    neighborPolicy: {
      blendsWith: ["settlement", "dirt", "ruin", "grass"],
      transitionBias: "cracked-cobble-threshold",
    },
  },
  "exposed-rock": {
    id: "exposed-rock",
    label: "Exposed Rock",
    material: "rock",
    sourceTextureSize: 128,
    runtimeTileSize: 64,
    atlasRoles: TERRAIN_FAMILY_ATLAS_ROLES,
    detailKinds: ["boulder", "rock", "pebble", "ore"],
    resources: ["stone", "ore"],
    lifecycle: {
      family: "mineral",
      growthYears: [0, 0],
      decayYears: [80000, 300000],
    },
    neighborPolicy: {
      blendsWith: ["dirt", "grass", "stone", "ruin"],
      transitionBias: "mineral-scree-edge",
    },
  },
  "ruin-masonry": {
    id: "ruin-masonry",
    label: "Ruin Masonry",
    material: "ruin",
    sourceTextureSize: 128,
    runtimeTileSize: 64,
    atlasRoles: TERRAIN_FAMILY_ATLAS_ROLES,
    detailKinds: ["wall", "stairs", "foundation", "ruin", "boulder", "rock", "pebble", "moss"],
    resources: ["stone", "ore"],
    lifecycle: {
      family: "ancient-structure",
      growthYears: [0, 0],
      decayYears: [1000, 180000],
    },
    neighborPolicy: {
      blendsWith: ["cobble", "rock", "dirt", "grass"],
      transitionBias: "mossy-ruin-lip",
    },
  },
  "reedbed-shore": {
    id: "reedbed-shore",
    label: "Reedbed Shore",
    material: "shore",
    sourceTextureSize: 128,
    runtimeTileSize: 64,
    atlasRoles: TERRAIN_FAMILY_ATLAS_ROLES,
    detailKinds: ["reeds", "fallen-log", "stump", "pebble", "tuft"],
    resources: ["fiber", "deadwood", "mycelium"],
    lifecycle: {
      family: "wetland",
      growthYears: [1, 20],
      decayYears: [2, 50],
    },
    neighborPolicy: {
      blendsWith: ["grass", "dirt", "stone", "water"],
      transitionBias: "wet-soft-bank",
    },
  },
  "settlement-plaza": {
    id: "settlement-plaza",
    label: "Settlement Plaza",
    material: "settlement",
    sourceTextureSize: 128,
    runtimeTileSize: 64,
    atlasRoles: TERRAIN_FAMILY_ATLAS_ROLES,
    detailKinds: ["foundation", "pebble", "tuft"],
    resources: ["stone"],
    lifecycle: {
      family: "worked-surface",
      growthYears: [0, 0],
      decayYears: [80, 100000],
    },
    neighborPolicy: {
      blendsWith: ["dirt", "stone", "field"],
      transitionBias: "worn-threshold",
    },
  },
};

const MATERIAL_DEFAULT_FAMILY = {
  grass: "living-meadow",
  field: "charged-rotland",
  dirt: "scrub-path",
  stone: "ancient-stonework",
  cobble: "broken-cobble",
  rock: "exposed-rock",
  ruin: "ruin-masonry",
  shore: "reedbed-shore",
  water: "reedbed-shore",
  settlement: "settlement-plaza",
};

const KIT_FAMILY = {
  "ancient-viaduct": "ruin-masonry",
  "sunken-courtyard": "ruin-masonry",
  "gatehouse-ruin": "ruin-masonry",
  "stormroot-ruin": "charged-rotland",
  "leywell-garden": "charged-rotland",
  "old-grove": "old-growth-woodland",
  "river-reedbed": "reedbed-shore",
};

export function terrainFamilyForTile(tile) {
  const composition = tile?.composition ?? {};
  const material = tile?.material ?? "grass";
  const materialSpecificFamily = ["cobble", "rock", "ruin", "shore"].includes(material)
    ? MATERIAL_DEFAULT_FAMILY[material]
    : null;
  const catalogId =
    materialSpecificFamily ??
    KIT_FAMILY[composition.kitKind] ??
    (composition.zone === "grove" || composition.detailFamily === "woodland" ? "old-growth-woodland" : null) ??
    (composition.zone === "shore" || composition.detailFamily === "shore" ? "reedbed-shore" : null) ??
    MATERIAL_DEFAULT_FAMILY[material] ??
    "living-meadow";
  const family = TERRAIN_FAMILY_CATALOG[catalogId] ?? TERRAIN_FAMILY_CATALOG["living-meadow"];
  const elevationRole = elevationRoleForTile(tile);
  const moistureRole = composition.moistureBand ?? "temperate";

  return {
    id: family.id,
    label: family.label,
    material,
    sourceTextureSize: family.sourceTextureSize,
    runtimeTileSize: family.runtimeTileSize,
    atlasRoles: family.atlasRoles,
    detailKinds: family.detailKinds,
    resources: family.resources,
    lifecycle: family.lifecycle,
    neighborPolicy: family.neighborPolicy,
    placement: {
      zone: composition.zone ?? "meadow",
      objectBand: composition.objectBand ?? "open",
      elevationRole,
      moistureRole,
      transitionBias: family.neighborPolicy.transitionBias,
      sliceableObjectKinds: family.detailKinds.filter((kind) => ["tree", "wall", "ruin", "foundation"].includes(kind)),
    },
  };
}

function elevationRoleForTile(tile) {
  const range = tile?.height?.range ?? 0;
  const average = tile?.height?.average ?? 0;
  if (tile?.material === "water") return "waterline";
  if (range > 1.4) return "slope";
  if (average > 2.1) return "high-ground";
  if (average < -0.1) return "low-ground";
  return "flat";
}
