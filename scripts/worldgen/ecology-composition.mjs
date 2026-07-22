import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const D8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const HABITATS = {
  W: { id: "water", color: "#315e66" },
  I: { id: "permanent-snow", color: "#eef2ef" },
  A: { id: "alpine", color: "#d9dedb" },
  T: { id: "tundra", color: "#899184" },
  M: { id: "marsh", color: "#3f6653" },
  R: { id: "riparian", color: "#52745a" },
  C: { id: "crag", color: "#6b6c68" },
  B: { id: "boreal-woodland", color: "#2e4a3c" },
  Q: { id: "temperate-rainforest", color: "#28543c" },
  F: { id: "temperate-woodland", color: "#36543a" },
  G: { id: "grassland", color: "#718450" },
  S: { id: "dry-scrub", color: "#827456" },
  H: { id: "heath", color: "#685f4c" },
};

export function composeWorldEcology(input, recipe, options = {}) {
  const bundle = structuredClone(input);
  const { cols, rows } = bundle.dimensions;
  const waterDistance = distanceField(bundle.fields.water, cols, rows, (value) => value > 0.45);
  const habitatGrid = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => classifyHabitat(bundle, x, y, waterDistance[y][x])));
  const habitatRows = habitatGrid.map((row) => row.join(""));
  const patches = habitatPatches(habitatGrid, recipe.ecology.minHabitatPatchTiles);
  const reachable = reachableFromSettlements(bundle, recipe);
  const resourceNodes = selectResourceNodes(bundle, recipe, habitatGrid, waterDistance, reachable);
  const landmarks = options.landmarks
    ? structuredClone(options.landmarks)
    : selectLandmarks(bundle, recipe, habitatGrid, waterDistance, reachable);
  bundle.ecology = {
    schema: "duskfell-world-ecology-v1",
    habitats: {
      classes: Object.fromEntries(Object.entries(HABITATS).map(([key, value]) => [key, value.id])),
      rows: habitatRows,
      patches,
    },
    resourceNodes,
    landmarks,
  };
  bundle.features.landmarks = landmarks;
  bundle.generation.ecology = {
    algorithm: "duskfell-climate-ecology-v1",
    habitatPatchCount: patches.length,
    resourceNodeCount: resourceNodes.length,
    landmarkCount: landmarks.length,
  };
  delete bundle.contentSha256;
  bundle.contentSha256 = crypto.createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
  return bundle;
}

export function buildTerrainDetailAuthorityPatch(bundle, recipe) {
  const units = bundle.dimensions.unitsPerTile;
  const offsetX = recipe.placement.offsetX;
  const offsetY = recipe.placement.offsetY;
  const resourceNodes = bundle.ecology.resourceNodes.map((node) => ({
    id: node.id,
    resourceNodeId: `terrain-detail:${node.id}`,
    kind: node.kind,
    x: round((offsetX + node.x) * units, 3),
    y: round((offsetY + node.y) * units, 3),
    resources: [{ kind: node.resource.toLowerCase(), amount: node.amount, maxAmount: node.maxAmount }],
    lifecycle: {
      family: node.lifecycle.family,
      stage: node.lifecycle.stage,
      species: node.lifecycle.species,
      ageYears: node.lifecycle.ageYears,
      health: node.lifecycle.health,
    },
    kitId: "worldgen-ecology-v1",
    kitKind: node.habitat,
    kitRole: node.role,
  }));
  const decayConsumers = resourceNodes
    .filter((node) => node.lifecycle.family === "mycelium")
    .map((node) => ({ id: node.id, x: node.x, y: node.y, consumes: [{ kind: "deadwood", amount: 1 }] }));
  return {
    schemaVersion: "duskfell-terrain-detail-authority-v1",
    projection: "military-plan-oblique",
    profile: "duskfell-terrain-v1",
    seed: recipe.seed,
    unitsPerTile: units,
    sourceWorld: {
      schemaVersion: "duskfell-generated-world-v1",
      width: recipe.placement.targetCols * units,
      height: recipe.placement.targetRows * units,
      terrainProfile: "duskfell-terrain-v1",
      sourceBundleSha256: bundle.contentSha256,
    },
    counts: { blockers: 0, resourceNodes: resourceNodes.length, decayConsumers: decayConsumers.length },
    blockers: [],
    resourceNodes,
    decayConsumers,
    activation: "review-only; replace terrain detail authority only during explicit world promotion",
  };
}

export function renderEcologyReview(bundle, recipe, gameplayPath, outputPath) {
  const pixelsPerTile = recipe.macro.gameplayPixelsPerTile;
  const resourceColors = {
    Wood: "#2f713f", Fiber: "#87a65b", Ore: "#89909a", Stone: "#b0aca0",
    Deadwood: "#68472f", Mycelium: "#9d78ad", Seed: "#d0ae55",
  };
  const draws = [];
  for (const node of bundle.ecology.resourceNodes) {
    const x = node.x * pixelsPerTile;
    const y = node.y * pixelsPerTile;
    const radius = node.lifecycle.stage === "ancient" ? 5 : 3.5;
    draws.push(`fill ${resourceColors[node.resource] ?? "#ffffff"} stroke #171814 stroke-width 1 circle ${round(x, 2)},${round(y, 2)} ${round(x + radius, 2)},${round(y, 2)}`);
  }
  for (const landmark of bundle.ecology.landmarks) {
    const x = landmark.x * pixelsPerTile;
    const y = landmark.y * pixelsPerTile;
    draws.push(`fill #d3b35b stroke #201b12 stroke-width 2 polygon ${round(x, 2)},${round(y - 8, 2)} ${round(x + 8, 2)},${round(y, 2)} ${round(x, 2)},${round(y + 8, 2)} ${round(x - 8, 2)},${round(y, 2)}`);
  }
  execFileSync("magick", [gameplayPath, "-draw", draws.join(" "), "-define", "png:compression-level=9", outputPath]);
  return { path: path.basename(outputPath), sha256: sha256(outputPath), width: bundle.dimensions.cols * pixelsPerTile, height: bundle.dimensions.rows * pixelsPerTile };
}

function classifyHabitat(bundle, x, y, waterDistance) {
  const climateZone = bundle.climate?.zones?.rows?.[y]?.[x];
  if (climateZone && HABITATS[climateZone]) return climateZone;
  const field = bundle.fields;
  if (field.water[y][x] > 0.45) return "W";
  if (field.snow[y][x] > 0.3) return "A";
  if (field.moisture[y][x] > 0.74 && field.slope[y][x] < 0.36) return "M";
  if (waterDistance <= 2.2 && field.moisture[y][x] > 0.48) return "R";
  if (field.rockiness[y][x] > 0.64 || field.slope[y][x] > 0.62) return "C";
  if (field.vegetation[y][x] > 0.5 && field.soil[y][x] > 0.42 && field.disturbance[y][x] < 0.62) return "F";
  if (field.vegetation[y][x] > 0.3 && field.soil[y][x] > 0.34) return "G";
  return "H";
}

function habitatPatches(grid, minimumTiles) {
  const rows = grid.length;
  const cols = grid[0].length;
  const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  const patches = [];
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    if (seen[y][x]) continue;
    const code = grid[y][x];
    const queue = [{ x, y }];
    seen[y][x] = true;
    const cells = [];
    for (let head = 0; head < queue.length; head += 1) {
      const point = queue[head];
      cells.push(point);
      for (const [dx, dy] of D8) {
        const nx = point.x + dx;
        const ny = point.y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen[ny][nx] || grid[ny][nx] !== code) continue;
        seen[ny][nx] = true;
        queue.push({ x: nx, y: ny });
      }
    }
    if (cells.length < minimumTiles) continue;
    patches.push({
      id: `habitat-${String(patches.length + 1).padStart(3, "0")}`,
      habitat: HABITATS[code].id,
      tiles: cells.length,
      centroid: {
        x: round(cells.reduce((sum, cell) => sum + cell.x + 0.5, 0) / cells.length),
        y: round(cells.reduce((sum, cell) => sum + cell.y + 0.5, 0) / cells.length),
      },
      bounds: {
        minX: Math.min(...cells.map((cell) => cell.x)), minY: Math.min(...cells.map((cell) => cell.y)),
        maxX: Math.max(...cells.map((cell) => cell.x)), maxY: Math.max(...cells.map((cell) => cell.y)),
      },
    });
  }
  return patches;
}

function selectResourceNodes(bundle, recipe, habitats, waterDistance, reachable) {
  const { cols, rows } = bundle.dimensions;
  const candidates = [];
  for (let y = 1; y < rows - 1; y += 1) for (let x = 1; x < cols - 1; x += 1) {
    if (!reachable[y][x] || bundle.fields.water[y][x] > 0.25 || bundle.fields.slope[y][x] > recipe.planning.maxTrailSlope) continue;
    if (bundle.fields.settlement[y][x] > 0.38 || bundle.fields.trail[y][x] > 0.7) continue;
    const habitat = HABITATS[habitats[y][x]].id;
    const spec = resourceSpec(bundle, x, y, habitat, waterDistance[y][x], recipe.seed);
    if (!spec) continue;
    const score = spec.suitability * 0.82 + hash01(x, y, recipe.seed + 1711) * 0.18;
    candidates.push({ x, y, habitat, score, spec });
  }
  candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  const selected = [];
  const quotas = [
    ["Wood", 0.25], ["Fiber", 0.14], ["Mycelium", 0.09], ["Ore", 0.17],
    ["Stone", 0.17], ["Seed", 0.1], ["Deadwood", 0.08],
  ];
  const addCandidate = (candidate) => {
    const node = makeResourceNode(candidate, 0, bundle, recipe);
    if (selected.some((placed) => Math.hypot(placed.x - node.x, placed.y - node.y) < recipe.ecology.minResourceSpacingTiles)) return false;
    selected.push(node);
    return true;
  };
  for (const [resource, ratio] of quotas) {
    const target = Math.max(1, Math.floor(recipe.ecology.maxResourceNodes * ratio));
    let count = 0;
    for (const candidate of candidates) {
      if (candidate.spec.resource !== resource || !addCandidate(candidate)) continue;
      count += 1;
      if (count >= target || selected.length >= recipe.ecology.maxResourceNodes) break;
    }
  }
  for (const candidate of candidates) {
    if (selected.length >= recipe.ecology.maxResourceNodes) break;
    addCandidate(candidate);
  }
  return selected.map((node, index) => ({ ...node, id: `ecology-${String(index + 1).padStart(3, "0")}` }));
}

function resourceSpec(bundle, x, y, habitat, waterDistance, seed) {
  const field = bundle.fields;
  const roll = hash01(x, y, seed + 811);
  if (["temperate-woodland", "temperate-rainforest", "boreal-woodland"].includes(habitat)) return { kind: "tree", resource: "Wood", family: "tree", role: "canopy", suitability: field.vegetation[y][x] * field.soil[y][x] };
  if (habitat === "riparian" || habitat === "marsh") {
    if (roll < 0.7) return { kind: "reeds", resource: "Fiber", family: "tree", role: "waterside-growth", suitability: field.moisture[y][x] * (1 - Math.min(1, waterDistance / 5)) };
    return { kind: "mushroom", resource: "Mycelium", family: "mycelium", role: "decomposer", suitability: field.moisture[y][x] * (1 - field.disturbance[y][x]) };
  }
  if (["crag", "alpine", "permanent-snow"].includes(habitat)) return { kind: "boulder", resource: roll < 0.54 ? "Ore" : "Stone", family: "mineral", role: "outcrop", suitability: field.rockiness[y][x] * (0.55 + field.slope[y][x] * 0.25) };
  if (habitat === "grassland" && roll < 0.18) return { kind: "tree", resource: "Seed", family: "tree", role: "seed-bearing", suitability: field.soil[y][x] * (1 - field.disturbance[y][x]) };
  if ((habitat === "dry-scrub" || habitat === "tundra") && roll < 0.22) return { kind: "reeds", resource: "Fiber", family: "tree", role: "low-growth", suitability: field.vegetation[y][x] * field.soil[y][x] };
  if (habitat === "heath" && roll < 0.12) return { kind: "fallen-log", resource: "Deadwood", family: "deadwood", role: "fallen", suitability: field.moisture[y][x] * (1 - field.disturbance[y][x]) };
  return null;
}

function makeResourceNode(candidate, index, bundle, recipe) {
  const hash = hash01(candidate.x, candidate.y, recipe.seed + 4093);
  const jitterX = 0.25 + hash01(candidate.x, candidate.y, recipe.seed + 4099) * 0.5;
  const jitterY = 0.25 + hash01(candidate.y, candidate.x, recipe.seed + 4111) * 0.5;
  const lifecycle = lifecycleFor(candidate, hash, bundle);
  const maxAmount = candidate.spec.resource === "Wood" ? 8 : candidate.spec.resource === "Ore" ? 7 : candidate.spec.resource === "Stone" ? 6 : 5;
  return {
    id: `ecology-${String(index + 1).padStart(3, "0")}`,
    kind: candidate.spec.kind,
    role: candidate.spec.role,
    habitat: candidate.habitat,
    x: round(candidate.x + jitterX),
    y: round(candidate.y + jitterY),
    resource: candidate.spec.resource,
    amount: Math.max(1, Math.round(maxAmount * (0.5 + lifecycle.health * 0.5))),
    maxAmount,
    suitability: round(candidate.spec.suitability),
    lifecycle,
  };
}

function lifecycleFor(candidate, hash, bundle) {
  const family = candidate.spec.family;
  const disturbance = bundle.fields.disturbance[candidate.y][candidate.x];
  const health = round(Math.max(0.18, Math.min(1, 0.58 + candidate.spec.suitability * 0.38 - disturbance * 0.24 + hash * 0.08)));
  if (family === "tree") {
    const stage = hash < 0.18 ? "sapling" : hash > 0.88 ? "ancient" : "mature";
    const ageYears = stage === "sapling" ? 2 + Math.floor(hash * 25) : stage === "ancient" ? 180 + Math.floor(hash * 420) : 24 + Math.floor(hash * 90);
    const species = candidate.spec.kind === "reeds" ? "terrain-river-reed" : treeSpecies(bundle, candidate.x, candidate.y);
    return { family, stage, species, ageYears, health };
  }
  if (family === "mineral") return { family, stage: "mineral", species: "terrain-stone", ageYears: 1000 + Math.floor(hash * 99000), health };
  if (family === "mycelium") return { family, stage: hash > 0.55 ? "fruiting" : "living", species: "terrain-veilcap", ageYears: 1 + Math.floor(hash * 9), health };
  return { family, stage: hash > 0.6 ? "decaying" : "deadwood", species: "terrain-deadwood", ageYears: 2 + Math.floor(hash * 38), health };
}

function treeSpecies(bundle, x, y) {
  const temperature = bundle.fields.temperature[y][x];
  const moisture = bundle.fields.moisture[y][x];
  const rock = bundle.fields.rockiness[y][x];
  if (rock > 0.52) return "ironleaf";
  if (moisture > 0.68) return "shadebark";
  if (temperature < 0.38) return "paleoak";
  return "greenwood";
}

function selectLandmarks(bundle, recipe, habitats, waterDistance, reachable) {
  const types = ["ancient-ruin", "sacred-grove", "mineral-scar", "waystone"];
  const candidatesByType = new Map();
  for (const type of types.slice(0, recipe.ecology.landmarkCount)) {
    const candidates = [];
    for (let y = 2; y < bundle.dimensions.rows - 2; y += 1) for (let x = 2; x < bundle.dimensions.cols - 2; x += 1) {
      if (!reachable[y][x] || bundle.fields.water[y][x] > 0.2 || bundle.fields.slope[y][x] > recipe.planning.maxTrailSlope) continue;
      const score = landmarkSuitability(type, bundle, habitats[y][x], waterDistance[y][x], x, y) + hash01(x, y, recipe.seed + types.indexOf(type) * 101) * 0.04;
      candidates.push({ x, y, score });
    }
    candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
    candidatesByType.set(type, candidates.slice(0, 128));
  }
  const sites = chooseLandmarkSites(
    types.slice(0, recipe.ecology.landmarkCount),
    candidatesByType,
    recipe.ecology.minLandmarkSpacingTiles,
  );
  if (!sites) return [];
  return sites.map(({ type, site }, index) => {
    const nearest = nearestSettlement(bundle.features.settlements, site.x + 0.5, site.y + 0.5);
    return {
      id: `landmark-${String(index + 1).padStart(2, "0")}`,
      type,
      name: landmarkName(type, index),
      x: site.x + 0.5,
      y: site.y + 0.5,
      suitability: round(site.score),
      accessFrom: nearest.id,
      distanceTiles: round(nearest.distance),
      composition: landmarkComposition(type, recipe.seed, site.x, site.y),
    };
  });
}

function chooseLandmarkSites(types, candidatesByType, minimumSpacing) {
  let explored = 0;
  function visit(index, selected) {
    if (index === types.length) return selected;
    if (explored >= 100_000) return null;
    const type = types[index];
    for (const site of candidatesByType.get(type) ?? []) {
      explored += 1;
      if (selected.some((entry) => Math.hypot(entry.site.x - site.x, entry.site.y - site.y) < minimumSpacing)) continue;
      const result = visit(index + 1, [...selected, { type, site }]);
      if (result) return result;
    }
    return null;
  }
  return visit(0, []);
}

function landmarkSuitability(type, bundle, habitatCode, waterDistance, x, y) {
  const habitat = HABITATS[habitatCode].id;
  const field = bundle.fields;
  if (type === "ancient-ruin") return field.rockiness[y][x] * 0.35 + (1 - field.disturbance[y][x]) * 0.35 + field.soil[y][x] * 0.12 + Math.min(1, waterDistance / 8) * 0.18;
  if (type === "sacred-grove") return (["temperate-woodland", "temperate-rainforest", "boreal-woodland"].includes(habitat) ? 0.5 : 0) + field.vegetation[y][x] * 0.3 + (1 - Math.min(1, waterDistance / 7)) * 0.2;
  if (type === "mineral-scar") return field.rockiness[y][x] * 0.66 + field.slope[y][x] * 0.18 + (habitat === "crag" ? 0.16 : 0);
  return bundle.fields.trail[y][x] * 0.6 + (1 - field.slope[y][x]) * 0.2 + field.rockiness[y][x] * 0.2;
}

function landmarkComposition(type, seed, x, y) {
  const age = 60000 + Math.floor(hash01(x, y, seed + 7013) * 140000);
  if (type === "ancient-ruin") return { kit: "ruin-composition-v1", stage: "sunken-foundation", ageYears: age, resource: "Stone" };
  if (type === "sacred-grove") return { kit: "grove-composition-v1", stage: "ancient", ageYears: 240 + Math.floor(age / 1000), resource: "Wood" };
  if (type === "mineral-scar") return { kit: "outcrop-composition-v1", stage: "mineral", ageYears: age, resource: "Ore" };
  return { kit: "waystone-composition-v1", stage: "ancient-ruin", ageYears: age, resource: "Stone" };
}

function landmarkName(type, index) {
  const names = {
    "ancient-ruin": ["The Sunken Court", "The Broken Archive"],
    "sacred-grove": ["Hushwood Ring", "The Elder Bower"],
    "mineral-scar": ["Ironwake Scar", "The Grey Delve"],
    waystone: ["The Northbound Stone", "The Ashen Marker"],
  };
  return names[type][index % names[type].length];
}

function nearestSettlement(settlements, x, y) {
  return settlements.map((settlement) => ({ id: settlement.id, distance: Math.hypot(settlement.x - x, settlement.y - y) })).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))[0];
}

function reachableFromSettlements(bundle, recipe) {
  const { cols, rows } = bundle.dimensions;
  const reachable = Array.from({ length: rows }, () => Array(cols).fill(false));
  const bridgeTiles = new Set(bundle.features.trails.flatMap((trail) => trail.bridges ?? []).map((point) => `${Math.floor(point.x)},${Math.floor(point.y)}`));
  const queue = bundle.features.settlements.map((settlement) => ({ x: Math.floor(settlement.x), y: Math.floor(settlement.y) }));
  for (const point of queue) reachable[point.y][point.x] = true;
  for (let head = 0; head < queue.length; head += 1) {
    const point = queue[head];
    for (const [dx, dy] of D8) {
      const x = point.x + dx;
      const y = point.y + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows || reachable[y][x]) continue;
      if (bundle.fields.slope[y][x] > recipe.planning.maxTrailSlope) continue;
      if (bundle.fields.water[y][x] > 0.25 && !bridgeTiles.has(`${x},${y}`)) continue;
      reachable[y][x] = true;
      queue.push({ x, y });
    }
  }
  return reachable;
}

function distanceField(values, cols, rows, source) {
  const result = Array.from({ length: rows }, () => Array(cols).fill(Infinity));
  const queue = [];
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) if (source(values[y][x])) {
    result[y][x] = 0;
    queue.push({ x, y });
  }
  for (let head = 0; head < queue.length; head += 1) {
    const point = queue[head];
    for (const [dx, dy] of D8) {
      const x = point.x + dx;
      const y = point.y + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const next = result[point.y][point.x] + Math.hypot(dx, dy);
      if (next >= result[y][x]) continue;
      result[y][x] = next;
      queue.push({ x, y });
    }
  }
  return result;
}

function hash01(x, y, seed) {
  let value = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function round(value, digits = 5) {
  return Number(value.toFixed(digits));
}
