import { PROJECTION } from "./projection.js";

export function terrainDetailAuthority(details, profile) {
  const blockers = [];
  const resourceNodes = [];
  const decayConsumers = [];

  for (const detail of details) {
    const authority = detail.authority;
    if (!authority) continue;
    const base = {
      id: detail.id,
      stableKey: authority.stableKey,
      kind: detail.kind,
      x: detail.x,
      y: detail.y,
      z: detail.z,
      tile: authority.tile,
      source: authority.source,
      kitId: detail.kitId,
      kitKind: detail.kitKind,
      kitRole: detail.kitRole,
      terrainFamily: detail.authority.generation.terrainFamily,
    };
    if (authority.collision?.blocksMovement) {
      blockers.push({
        ...base,
        collision: authority.collision,
      });
    }
    if (authority.resourceNodeId) {
      resourceNodes.push({
        ...base,
        resourceNodeId: authority.resourceNodeId,
        resources: detail.resources,
        lifecycle: detail.lifecycle ?? null,
      });
    }
    if (authority.decayConsumer) {
      decayConsumers.push({
        ...base,
        ...authority.decayConsumer,
        resources: detail.resources ?? [],
        lifecycle: detail.lifecycle ?? null,
      });
    }
  }

  return {
    schemaVersion: "duskfell-terrain-detail-authority-v1",
    projection: PROJECTION.kind,
    profile: profile.profile,
    seed: profile.seed,
    unitsPerTile: profile.unitsPerTile,
    blockers,
    resourceNodes,
    decayConsumers,
  };
}

export function terrainDetailAuthorityMetadata(id, tile, profile, kind, seed, u, v, z, footprint, metadata, kit) {
  const hasResources = Array.isArray(metadata.resources) && metadata.resources.length > 0;
  const consumes = Array.isArray(metadata.consumes) ? metadata.consumes : [];
  return {
    schemaVersion: "duskfell-terrain-detail-authority-v1",
    stableKey: [
      profile.profile,
      profile.seed,
      kit.kitId ?? "procedural",
      kit.kitRole ?? "none",
      kind,
      tile.x,
      tile.y,
      seed,
    ].join(":"),
    source: kit.kitId ? "composition-kit" : "procedural-terrain",
    tile: { x: tile.x, y: tile.y },
    anchor: { u, v, z },
    generation: {
      profile: profile.profile,
      seed: profile.seed,
      detailSeed: seed,
      material: tile.material,
      terrainFamily: tile.family?.id ?? null,
      zone: tile.composition?.zone ?? "meadow",
      objectBand: tile.composition?.objectBand ?? "open",
      kitId: kit.kitId,
      kitKind: kit.kitKind,
      kitRole: kit.kitRole,
    },
    collision: {
      blocksMovement: Boolean(footprint.blocksMovement),
      shape: "aabb",
      widthTiles: footprint.widthTiles,
      heightTiles: footprint.heightTiles,
      reserveRadiusTiles: footprint.reserveRadiusTiles,
    },
    resourceNodeId: hasResources ? `terrain-detail:${id}` : null,
    decayConsumer: consumes.length > 0 ? { consumes } : null,
  };
}
