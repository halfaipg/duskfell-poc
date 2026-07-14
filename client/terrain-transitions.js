import {
  TERRAIN_MATERIALS,
  biomeForTile,
  materialForBiome,
  materialPriority,
} from "./terrain-primitives.js";
import { materialForCompositionKit } from "./terrain-composition-kit.js";

export function transitionsForTile(x, y, material, cols, rows, safeRadiusTiles, profile, compositionKits = [], materialAt = null) {
  const edges = [
    ["north", x, y - 1],
    ["east", x + 1, y],
    ["south", x, y + 1],
    ["west", x - 1, y],
  ];
  const transitions = [];

  for (const [edge, nx, ny] of edges) {
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const nextMaterial = materialForTileWithCompositionKits(nx, ny, cols, rows, safeRadiusTiles, profile, compositionKits, materialAt);
    if (nextMaterial === material) continue;
    if (materialPriority(nextMaterial) < materialPriority(material)) continue;
    transitions.push({
      type: "edge",
      edge,
      from: material,
      to: nextMaterial,
      pair: transitionPair(material, nextMaterial),
      family: transitionFamily(material, nextMaterial),
      seed: transitionSeed(x, y, edge, material, nextMaterial, profile.seed),
      color: TERRAIN_MATERIALS[nextMaterial].transition,
      mask: {
        type: "edge",
        edge,
        depth: transitionDepth(material, nextMaterial),
      },
    });
  }
  for (const corner of cornerTransitionsForTile(x, y, material, cols, rows, safeRadiusTiles, profile, compositionKits, materialAt)) {
    transitions.push(corner);
  }
  return transitions;
}

function cornerTransitionsForTile(x, y, material, cols, rows, safeRadiusTiles, profile, compositionKits = [], materialAt = null) {
  const corners = [
    ["northEast", x + 1, y - 1, ["north", "east"]],
    ["southEast", x + 1, y + 1, ["east", "south"]],
    ["southWest", x - 1, y + 1, ["south", "west"]],
    ["northWest", x - 1, y - 1, ["west", "north"]],
  ];
  const transitions = [];

  for (const [corner, nx, ny, adjacentEdges] of corners) {
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const nextMaterial = materialForTileWithCompositionKits(nx, ny, cols, rows, safeRadiusTiles, profile, compositionKits, materialAt);
    if (nextMaterial === material) continue;
    if (materialPriority(nextMaterial) < materialPriority(material)) continue;
    const adjacentHasSameTransition = adjacentEdges.some((edge) =>
      transitionsForNeighborMaterial(x, y, edge, nextMaterial, cols, rows, safeRadiusTiles, profile, compositionKits, materialAt),
    );
    if (adjacentHasSameTransition) continue;
    transitions.push({
      type: "corner",
      corner,
      from: material,
      to: nextMaterial,
      pair: transitionPair(material, nextMaterial),
      family: transitionFamily(material, nextMaterial),
      seed: transitionSeed(x, y, corner, material, nextMaterial, profile.seed),
      color: TERRAIN_MATERIALS[nextMaterial].transition,
      mask: {
        type: "corner",
        corner,
        depth: transitionDepth(material, nextMaterial) * 0.92,
      },
    });
  }

  return transitions;
}

function transitionsForNeighborMaterial(x, y, edge, material, cols, rows, safeRadiusTiles, profile, compositionKits = [], materialAt = null) {
  const offset = {
    north: [0, -1],
    east: [1, 0],
    south: [0, 1],
    west: [-1, 0],
  }[edge];
  if (!offset) return false;
  const nx = x + offset[0];
  const ny = y + offset[1];
  if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;
  return materialForTileWithCompositionKits(nx, ny, cols, rows, safeRadiusTiles, profile, compositionKits, materialAt) === material;
}

function materialForTileWithCompositionKits(x, y, cols, rows, safeRadiusTiles, profile, compositionKits, materialAt = null) {
  if (materialAt) return materialAt(x, y);
  if (x < 0 || y < 0 || x >= cols || y >= rows) return "grass";
  const biome = biomeForTile(x, y, cols, rows, safeRadiusTiles, profile);
  return materialForCompositionKit(x, y, materialForBiome(biome), biome, compositionKits);
}

function transitionDepth(fromMaterial, toMaterial) {
  if (toMaterial === "water") return 0.46;
  if (fromMaterial === "water") return 0.42;
  if (toMaterial === "shore" || fromMaterial === "shore") return 0.42;
  if (toMaterial === "settlement") return 0.38;
  if (toMaterial === "stone" || toMaterial === "rock" || toMaterial === "ruin" || toMaterial === "cobble") return 0.36;
  if (toMaterial === "grass" || toMaterial === "field") return 0.3;
  return 0.34;
}

function transitionPair(fromMaterial, toMaterial) {
  return `${fromMaterial}->${toMaterial}`;
}

function transitionFamily(fromMaterial, toMaterial) {
  if (fromMaterial === "water" || toMaterial === "water" || fromMaterial === "shore" || toMaterial === "shore") return "shore";
  if (fromMaterial === "settlement" || toMaterial === "settlement" || fromMaterial === "cobble" || toMaterial === "cobble") return "plaza";
  if (fromMaterial === "stone" || toMaterial === "stone" || fromMaterial === "rock" || toMaterial === "rock" || fromMaterial === "ruin" || toMaterial === "ruin") return "rocky";
  if (fromMaterial === "dirt" || toMaterial === "dirt") return "path";
  return "soft";
}

function transitionSeed(x, y, edge, fromMaterial, toMaterial, seed) {
  let hash = Math.imul(x + 193, 374761393) ^ Math.imul(y + 389, 668265263) ^ Math.imul(seed + 83, 2246822519);
  const text = `${edge}:${fromMaterial}:${toMaterial}`;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 3266489917);
  }
  return hash >>> 0;
}
