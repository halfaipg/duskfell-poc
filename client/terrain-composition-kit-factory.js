export function createTerrainCompositionKits(cols, rows, safeRadiusTiles, profile) {
  const centerX = cols / 2;
  const centerY = rows / 2;
  const westWildsX = cols * 0.16;
  const eastWildsX = cols * 0.84;
  const northApproachY = rows * 0.17;
  const southWildsY = rows * 0.78;
  const farNorthY = rows * 0.11;
  const deepSouthY = rows * 0.86;
  return [
    {
      id: "settlement-crossroads",
      kind: "settlement-core",
      label: "Settlement Crossroads",
      x: centerX,
      y: centerY,
      radius: Math.max(2.2, safeRadiusTiles * 0.74),
      priority: 10,
    },
    {
      id: "ancient-viaduct-kit",
      kind: "ancient-viaduct",
      label: "Ancient Viaduct Approach",
      x: clamp(eastWildsX - safeRadiusTiles * 0.24, 5, cols - 5),
      y: clamp(northApproachY + safeRadiusTiles * 0.86, 4, rows - 5),
      radius: Math.max(3.8, safeRadiusTiles * 0.82),
      length: Math.max(4.8, safeRadiusTiles * 1.22),
      width: 0.95,
      priority: 30,
    },
    {
      id: "sunken-courtyard-kit",
      kind: "sunken-courtyard",
      label: "Sunken Courtyard Ruin",
      x: clamp(eastWildsX, 6, cols - 6),
      y: clamp(farNorthY + safeRadiusTiles * 0.18, 4, rows - 6),
      halfWidth: Math.max(2.2, safeRadiusTiles * 0.56),
      halfHeight: Math.max(1.7, safeRadiusTiles * 0.42),
      priority: 35,
    },
    {
      id: "north-gatehouse-kit",
      kind: "gatehouse-ruin",
      label: "Ruined North Gatehouse",
      x: clamp(centerX, 5, cols - 5),
      y: clamp(farNorthY, 3, rows - 6),
      halfWidth: Math.max(1.85, safeRadiusTiles * 0.42),
      halfHeight: Math.max(1.25, safeRadiusTiles * 0.28),
      passageWidth: 0.58,
      thresholdDepth: 0.72,
      priority: 33,
    },
    {
      id: "old-grove-ring",
      kind: "old-grove",
      label: "Old Grove Ring",
      x: clamp(westWildsX, 4, cols - 5),
      y: clamp(northApproachY + safeRadiusTiles * 0.08, 4, rows - 5),
      radius: Math.max(2.9, safeRadiusTiles * 0.66),
      priority: 20,
    },
    {
      id: "stormroot-ruin-kit",
      kind: "stormroot-ruin",
      label: "Stormroot Charged Ruin",
      x: clamp(westWildsX + safeRadiusTiles * 0.44, 5, cols - 6),
      y: clamp(southWildsY, 5, rows - 5),
      radius: Math.max(3.1, safeRadiusTiles * 0.64),
      coreRadius: Math.max(1.02, safeRadiusTiles * 0.24),
      wireWidth: 0.54,
      priority: 28,
    },
    {
      id: "river-reedbed",
      kind: "river-reedbed",
      label: "River Reedbed",
      x: clamp(centerX - safeRadiusTiles * 0.12, 4, cols - 5),
      y: clamp(deepSouthY, 5, rows - 4),
      radius: Math.max(3.1, safeRadiusTiles * 0.68),
      priority: 15,
    },
    {
      id: "leywell-garden-kit",
      kind: "leywell-garden",
      label: "Leywell Garden",
      x: clamp(eastWildsX - safeRadiusTiles * 0.08, 5, cols - 5),
      y: clamp(southWildsY + safeRadiusTiles * 0.22, 5, rows - 5),
      radius: Math.max(2.9, safeRadiusTiles * 0.64),
      basinRadius: Math.max(0.9, safeRadiusTiles * 0.22),
      conduitWidth: 0.46,
      priority: 24,
    },
  ].map((kit) => ({
    ...kit,
    seed: kitSeed(Math.round(kit.x), Math.round(kit.y), kit.kind, kit.id, profile.seed),
  }));
}

function kitSeed(x, y, kind, id, profileSeed) {
  let hash = Math.imul(x + 193, 374761393) ^ Math.imul(y + 389, 668265263);
  const text = `${kind}:${id}:${profileSeed}`;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 3266489917);
  }
  return hash >>> 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
