export const TERRAIN_COMPOSITION_KIT_CATALOG = [
  {
    kind: "settlement-core",
    label: "Settlement Crossroads",
    purpose: "anchors the safe-zone plaza and crossing roads",
    roles: ["plaza", "road", "threshold"],
  },
  {
    kind: "ancient-viaduct",
    label: "Ancient Viaduct Approach",
    purpose: "forces a coherent stone causeway with rubble and overgrowth",
    roles: ["causeway", "rubble"],
  },
  {
    kind: "sunken-courtyard",
    label: "Sunken Courtyard Ruin",
    purpose: "builds a readable multi-role ruin with walls, stairs, and floor",
    roles: ["wall-north", "wall-south", "wall-east", "wall-west", "stairs", "courtyard-floor", "courtyard-rubble"],
  },
  {
    kind: "old-grove",
    label: "Old Grove Ring",
    purpose: "clusters tree lifecycle/resource detail around a readable grove",
    roles: ["canopy", "understory"],
  },
  {
    kind: "river-reedbed",
    label: "River Reedbed",
    purpose: "clusters shore ecology at wet edges instead of scattering reeds randomly",
    roles: ["reedline", "wet-edge"],
  },
];

export function createTerrainCompositionKits(cols, rows, safeRadiusTiles, profile) {
  const centerX = cols / 2;
  const centerY = rows / 2;
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
      x: clamp(centerX + safeRadiusTiles * 1.48, 4, cols - 4),
      y: clamp(centerY - safeRadiusTiles * 0.88, 3, rows - 4),
      radius: Math.max(4.2, safeRadiusTiles * 1.12),
      length: Math.max(4.8, safeRadiusTiles * 1.72),
      width: 0.95,
      priority: 30,
    },
    {
      id: "sunken-courtyard-kit",
      kind: "sunken-courtyard",
      label: "Sunken Courtyard Ruin",
      x: clamp(centerX + safeRadiusTiles * 0.92, 5, cols - 5),
      y: clamp(centerY - safeRadiusTiles * 1.18, 4, rows - 5),
      halfWidth: Math.max(2.4, safeRadiusTiles * 0.82),
      halfHeight: Math.max(1.8, safeRadiusTiles * 0.62),
      priority: 35,
    },
    {
      id: "old-grove-ring",
      kind: "old-grove",
      label: "Old Grove Ring",
      x: clamp(centerX - safeRadiusTiles * 1.62, 3, cols - 4),
      y: clamp(centerY - safeRadiusTiles * 0.78, 3, rows - 4),
      radius: Math.max(3.2, safeRadiusTiles * 0.94),
      priority: 20,
    },
    {
      id: "river-reedbed",
      kind: "river-reedbed",
      label: "River Reedbed",
      x: clamp(centerX - safeRadiusTiles * 1.2, 3, cols - 4),
      y: clamp(rows * 0.82, 4, rows - 3),
      radius: Math.max(3.4, safeRadiusTiles),
      priority: 15,
    },
  ].map((kit) => ({
    ...kit,
    seed: kitSeed(Math.round(kit.x), Math.round(kit.y), kit.kind, kit.id, profile.seed),
  }));
}

export function materialForCompositionKit(x, y, material, biome, compositionKits) {
  if (material === "water") return material;
  const viaduct = compositionKits.find((kit) => kit.kind === "ancient-viaduct");
  const courtyard = compositionKits.find((kit) => kit.kind === "sunken-courtyard");
  if (courtyard) {
    const metrics = courtyardMetrics(x, y, courtyard);
    if (metrics.onWall || metrics.onStairs || metrics.inFloor) return "stone";
    if (metrics.inRubble && biome.plazaPressure < 0.12) return "dirt";
  }
  if (!viaduct) return material;
  const metrics = viaductMetrics(x, y, viaduct);
  if (metrics.onCauseway) return "stone";
  if (metrics.inRubble && biome.plazaPressure < 0.12 && material === "grass") return "dirt";
  return material;
}

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

export function viaductMetrics(x, y, kit) {
  const dx = x + 0.5 - kit.x;
  const dy = y + 0.5 - kit.y;
  const along = (dx - dy) / Math.SQRT2;
  const across = (dx + dy) / Math.SQRT2;
  const onCauseway = Math.abs(along) <= kit.length && Math.abs(across) <= kit.width;
  const inRubble = Math.hypot(dx, dy) <= kit.radius && Math.abs(across) <= kit.width + 2.6;
  return { along, across, onCauseway, inRubble };
}

export function courtyardMetrics(x, y, kit) {
  const dx = x + 0.5 - kit.x;
  const dy = y + 0.5 - kit.y;
  const halfWidth = kit.halfWidth;
  const halfHeight = kit.halfHeight;
  const withinWidth = Math.abs(dx) <= halfWidth;
  const withinHeight = Math.abs(dy) <= halfHeight;
  const inside = withinWidth && withinHeight;
  const onNorth = inside && Math.abs(dy + halfHeight) <= 0.62;
  const onSouth = inside && Math.abs(dy - halfHeight) <= 0.62;
  const onWest = inside && Math.abs(dx + halfWidth) <= 0.62;
  const onEast = inside && Math.abs(dx - halfWidth) <= 0.62;
  const onStairs = Math.abs(dx) <= 0.92 && dy > halfHeight - 0.72 && dy <= halfHeight + 1.24;
  const onWall = onNorth || onSouth || onWest || onEast;
  const inFloor = inside && !onWall;
  const inRubble = Math.abs(dx) <= halfWidth + 1.6 && Math.abs(dy) <= halfHeight + 1.6;
  const wallRole = onNorth ? "wall-north" : onSouth ? "wall-south" : onWest ? "wall-west" : onEast ? "wall-east" : "wall";
  return { dx, dy, onWall, wallRole, onStairs, inFloor, inRubble };
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
