export const MAX_PLAYERS = 512;
export const MAX_NPCS = 64;
export const MAX_OBJECTS = 4096;
export const MAX_INVENTORY_SLOTS = 32;
export const MAX_RESOURCE_COUNT = 999;
export const MAX_LIFECYCLE_AGE_YEARS = 1_000_000;
export const MAX_TEXT = 128;

export const OBJECT_KINDS = new Set([
  "registrar",
  "forge",
  "grove",
  "ore",
  "shrine",
  "saplingTree",
  "deadwood",
  "myceliumPatch",
  "fieldCoil",
  "ruin",
]);

export const RESOURCE_KINDS = new Set([
  "wood",
  "ore",
  "stone",
  "charge",
  "deadwood",
  "fiber",
  "mycelium",
  "spores",
  "seed",
]);

export const TERRAIN_PROFILE = "duskfell-terrain-v1";
export const TERRAIN_MATERIALS = new Set([
  "grass",
  "field",
  "dirt",
  "stone",
  "water",
  "settlement",
  "cobble",
  "rock",
  "ruin",
  "shore",
]);
