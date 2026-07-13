import { PROJECTION } from "./projection.js";
import { buildWorldData } from "./world-data.js";
import { interiorHeightAt, interiorPortalAt } from "./interior-occlusion.js";
import { terrainChunks, elevationEdgesForTile } from "./terrain-chunks.js";
import { terrainCompositionForTile } from "./terrain-composition.js";
import { decalsForTile } from "./terrain-decals.js";
import { terrainInteriorSpaces } from "./terrain-interiors.js";
import { terrainDetails } from "./terrain-detail-placement.js";
import {
  TERRAIN_MATERIALS,
  bilerp,
  biomeForTile,
  clamp,
  cornerHeights,
  materialForBiome,
  materialForTile,
  terrainHeightMetadata,
  terrainProfile,
} from "./terrain-primitives.js";
import {
  createTerrainCompositionKits,
  materialForCompositionKit,
} from "./terrain-composition-kit.js";
import { transitionsForTile } from "./terrain-transitions.js";
import { terrainDetailAuthority } from "./terrain-details.js";
import { terrainFamilyForTile } from "./terrain-family.js";

export { TERRAIN_MATERIALS, biomeForTile, materialForTile, terrainHeightMetadata };
export { projectTerrainTile, terrainFacets } from "./terrain-geometry.js";

export function buildTerrain(map) {
  const profile = terrainProfile(map);
  const cols = Math.ceil(map.width / profile.unitsPerTile);
  const rows = Math.ceil(map.height / profile.unitsPerTile);
  const safeRadiusTiles = map.safeZoneRadius / profile.unitsPerTile;
  const compositionKits = createTerrainCompositionKits(cols, rows, safeRadiusTiles, profile);
  const tiles = [];

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const biome = biomeForTile(x, y, cols, rows, safeRadiusTiles, profile);
      const material = materialForCompositionKit(x, y, materialForBiome(biome), biome, compositionKits);
      const heights = cornerHeights(x, y, cols, rows, safeRadiusTiles, material, profile);
      const height = terrainHeightMetadata(heights);
      const composition = terrainCompositionForTile(
        x,
        y,
        material,
        biome,
        cols,
        rows,
        safeRadiusTiles,
        profile,
        height,
        compositionKits,
      );
      const family = terrainFamilyForTile({ x, y, material, biome, composition, heights, height });
      tiles.push({
        x,
        y,
        material,
        biome,
        composition,
        family,
        heights,
        height,
        sloped: height.range > 0,
        transitions: transitionsForTile(x, y, material, cols, rows, safeRadiusTiles, profile, compositionKits),
        decals: decalsForTile(x, y, material, profile, biome, composition),
        elevationEdges: [],
      });
    }
  }
  for (const tile of tiles) {
    tile.elevationEdges = elevationEdgesForTile(tile, tiles, cols, rows);
  }
  const worldData = buildWorldData(tiles, cols, rows, safeRadiusTiles, profile);
  const details = terrainDetails(tiles, cols, rows, safeRadiusTiles, profile, compositionKits);
  const detailAuthority = terrainDetailAuthority(details, profile);
  const chunks = terrainChunks(tiles, cols, rows);
  const interiorSpaces = terrainInteriorSpaces(compositionKits, profile);

  return {
    cols,
    rows,
    worldData,
    width: map.width,
    height: map.height,
    safeRadiusTiles,
    profile,
    compositionKits,
    tiles,
    chunks,
    details,
    detailAuthority,
    interiorSpaces,
  };
}

export function terrainTileAt(terrain, tileX, tileY) {
  if (!terrain || tileX < 0 || tileY < 0 || tileX >= terrain.cols || tileY >= terrain.rows) {
    return null;
  }
  return terrain.tiles[tileY * terrain.cols + tileX] ?? null;
}

export function terrainHeightAtWorld(terrain, worldX, worldY) {
  if (!terrain) return 0;
  const unitsPerTile = terrain.profile?.unitsPerTile ?? PROJECTION.unitsPerTile;
  const mapX = clamp(worldX / unitsPerTile, 0, Math.max(0, terrain.cols - 0.001));
  const mapY = clamp(worldY / unitsPerTile, 0, Math.max(0, terrain.rows - 0.001));
  const tileX = Math.floor(mapX);
  const tileY = Math.floor(mapY);
  const tile = terrainTileAt(terrain, tileX, tileY);
  if (!tile) return 0;

  const fx = mapX - tileX;
  const fy = mapY - tileY;
  const terrainZ = bilerp(tile.heights.nw, tile.heights.ne, tile.heights.sw, tile.heights.se, fx, fy);
  const interior = terrainInteriorHeightAtWorld(terrain, worldX, worldY, terrainZ);
  return terrainZ + (interior?.z ?? 0);
}

export function terrainInteriorHeightAtWorld(terrain, worldX, worldY, baseZ = 0) {
  if (!terrain || !Array.isArray(terrain.interiorSpaces)) return null;
  for (const space of terrain.interiorSpaces) {
    const position = { x: worldX, y: worldY, z: 0 };
    if (interiorPortalAt(space, position)) {
      return {
        ...interiorHeightAt(space, position),
        space,
      };
    }
    const padding = Math.max(0, space.revealPadding ?? 0);
    const bounds = space.bounds;
    if (
      !bounds ||
      worldX < bounds.minX - padding ||
      worldX > bounds.maxX + padding ||
      worldY < bounds.minY - padding ||
      worldY > bounds.maxY + padding
    ) {
      continue;
    }
    const height = interiorHeightAt(space, position);
    if (height) {
      return {
        ...height,
        space,
      };
    }
  }
  return null;
}

export function terrainWalkabilityAtWorld(terrain, worldX, worldY) {
  if (!terrain) {
    return {
      walkable: false,
      reason: "missing-terrain",
      tile: null,
      blockers: [],
    };
  }
  const unitsPerTile = terrain.profile?.unitsPerTile ?? PROJECTION.unitsPerTile;
  const mapX = worldX / unitsPerTile;
  const mapY = worldY / unitsPerTile;
  const tileX = Math.floor(mapX);
  const tileY = Math.floor(mapY);
  const tile = terrainTileAt(terrain, tileX, tileY);
  if (!tile) {
    return {
      walkable: false,
      reason: "out-of-bounds",
      tile: null,
      blockers: [],
    };
  }
  if (tile.material === "water") {
    return {
      walkable: false,
      reason: "water",
      tile,
      blockers: [],
    };
  }
  const maxWalkableStep = terrain.profile?.maxWalkableStep ?? 1;
  if ((tile.height?.range ?? 0) > maxWalkableStep + 1.2) {
    return {
      walkable: false,
      reason: "steep",
      tile,
      blockers: [],
    };
  }
  const blockers = terrainDetailBlockersAtWorld(terrain, worldX, worldY);
  if (blockers.length > 0) {
    return {
      walkable: false,
      reason: "blocked-detail",
      tile,
      blockers,
    };
  }
  return {
    walkable: true,
    reason: "walkable",
    tile,
    blockers: [],
  };
}

export function terrainDetailBlockersAtWorld(terrain, worldX, worldY) {
  if (!terrain || !Array.isArray(terrain.details)) return [];
  const unitsPerTile = terrain.profile?.unitsPerTile ?? PROJECTION.unitsPerTile;
  return terrain.details.filter((detail) => {
    if (!detail.footprint?.blocksMovement) return false;
    const halfWidth = Math.max(0.12, detail.footprint.widthTiles / 2) * unitsPerTile;
    const halfHeight = Math.max(0.12, detail.footprint.heightTiles / 2) * unitsPerTile;
    const dx = Math.abs(worldX - detail.x);
    const dy = Math.abs(worldY - detail.y);
    return dx <= halfWidth && dy <= halfHeight;
  });
}
