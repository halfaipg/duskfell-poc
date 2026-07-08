import { readFile } from "node:fs/promises";

import { buildTerrain } from "../client/terrain.js";

export const TERRAIN_DETAIL_AUTHORITY_PATH = "assets/terrain/detail-authority.json";
export const TERRAIN_DETAIL_AUTHORITY_SCHEMA_VERSION = "duskfell-terrain-detail-authority-v1";

export async function buildTerrainDetailAuthorityFromWorld(worldPath = "server/data/world.json") {
  const world = JSON.parse(await readFile(worldPath, "utf8"));
  if (!world?.map?.terrain) {
    throw new Error(`${worldPath} must include map.terrain`);
  }
  const terrain = buildTerrain(world.map);
  return normalizeTerrainDetailAuthority({
    ...terrain.detailAuthority,
    sourceWorld: {
      schemaVersion: world.schemaVersion,
      width: world.map.width,
      height: world.map.height,
      safeZoneRadius: world.map.safeZoneRadius,
      terrainProfile: world.map.terrain.profile,
    },
  });
}

export function normalizeTerrainDetailAuthority(authority) {
  if (authority?.schemaVersion !== TERRAIN_DETAIL_AUTHORITY_SCHEMA_VERSION) {
    throw new Error(`schemaVersion must be ${TERRAIN_DETAIL_AUTHORITY_SCHEMA_VERSION}`);
  }
  const blockers = normalizedEntries(authority.blockers, "blockers");
  const resourceNodes = normalizedEntries(authority.resourceNodes, "resourceNodes");
  const decayConsumers = normalizedEntries(authority.decayConsumers, "decayConsumers");
  return {
    schemaVersion: authority.schemaVersion,
    projection: requiredString(authority.projection, "projection"),
    profile: requiredString(authority.profile, "profile"),
    seed: requiredInteger(authority.seed, "seed"),
    unitsPerTile: requiredInteger(authority.unitsPerTile, "unitsPerTile"),
    sourceWorld: authority.sourceWorld ?? null,
    counts: {
      blockers: blockers.length,
      resourceNodes: resourceNodes.length,
      decayConsumers: decayConsumers.length,
    },
    blockers,
    resourceNodes,
    decayConsumers,
  };
}

export function validateTerrainDetailAuthority(authority) {
  const normalized = normalizeTerrainDetailAuthority(authority);
  for (const groupName of ["blockers", "resourceNodes", "decayConsumers"]) {
    const seenIds = new Set();
    const seenStableKeys = new Set();
    for (const entry of normalized[groupName]) {
      if (seenIds.has(entry.id)) {
        throw new Error(`duplicate terrain detail authority id ${entry.id}`);
      }
      seenIds.add(entry.id);
      if (seenStableKeys.has(entry.stableKey)) {
        throw new Error(`duplicate terrain detail authority stableKey ${entry.stableKey}`);
      }
      seenStableKeys.add(entry.stableKey);
      if (!["composition-kit", "procedural-terrain"].includes(entry.source)) {
        throw new Error(`${groupName}.${entry.id}.source is unsupported`);
      }
      if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y) || !Number.isFinite(entry.z)) {
        throw new Error(`${groupName}.${entry.id} coordinates must be finite`);
      }
      if (!entry.tile || !Number.isInteger(entry.tile.x) || !Number.isInteger(entry.tile.y)) {
        throw new Error(`${groupName}.${entry.id}.tile must use integer x/y`);
      }
    }
  }
  for (const blocker of normalized.blockers) {
    if (blocker.collision?.blocksMovement !== true || blocker.collision?.shape !== "aabb") {
      throw new Error(`blocker ${blocker.id} must expose a blocking aabb collision shape`);
    }
  }
  for (const node of normalized.resourceNodes) {
    if (!node.resourceNodeId || !Array.isArray(node.resources) || node.resources.length === 0) {
      throw new Error(`resource node ${node.id} must expose resources and resourceNodeId`);
    }
  }
  for (const consumer of normalized.decayConsumers) {
    if (!Array.isArray(consumer.consumes) || !consumer.consumes.some((resource) => resource.kind === "deadwood")) {
      throw new Error(`decay consumer ${consumer.id} must consume deadwood`);
    }
  }
  return normalized;
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizedEntries(entries, field) {
  if (!Array.isArray(entries)) {
    throw new Error(`${field} must be an array`);
  }
  return entries
    .map((entry) => normalizeEntry(entry, field))
    .sort((a, b) => a.stableKey.localeCompare(b.stableKey) || a.id.localeCompare(b.id));
}

function normalizeEntry(entry, field) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${field} entries must be objects`);
  }
  const normalized = {
    id: requiredString(entry.id, `${field}.id`),
    stableKey: requiredString(entry.stableKey, `${field}.stableKey`),
    kind: requiredString(entry.kind, `${field}.kind`),
    x: requiredNumber(entry.x, `${field}.x`),
    y: requiredNumber(entry.y, `${field}.y`),
    z: requiredNumber(entry.z, `${field}.z`),
    tile: {
      x: requiredInteger(entry.tile?.x, `${field}.tile.x`),
      y: requiredInteger(entry.tile?.y, `${field}.tile.y`),
    },
    source: requiredString(entry.source, `${field}.source`),
    kitId: entry.kitId ?? null,
    kitKind: entry.kitKind ?? null,
    kitRole: entry.kitRole ?? "none",
    terrainFamily: entry.terrainFamily ?? null,
  };
  if (entry.collision) normalized.collision = entry.collision;
  if (entry.resourceNodeId) normalized.resourceNodeId = entry.resourceNodeId;
  if (entry.resources) normalized.resources = entry.resources;
  if (entry.lifecycle !== undefined) normalized.lifecycle = entry.lifecycle;
  if (entry.consumes) normalized.consumes = entry.consumes;
  return normalized;
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requiredNumber(value, field) {
  if (!Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function requiredInteger(value, field) {
  if (!Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`);
  }
  return value;
}
