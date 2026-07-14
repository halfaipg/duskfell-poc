import { PROJECTION } from "./projection.js";
import { buildWorldData, buildWorldDataFromGrids } from "./world-data.js";
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

export function buildTerrain(map, bundle = null) {
  if (bundle && Array.isArray(bundle.materialGrid)) {
    return buildTerrainFromBundle(map, bundle);
  }
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

// Bundle worlds: tiles come from baked grids (terrain-diffusion bridge)
// instead of the island formulas. Composition kits, transitions, decals,
// details and chunks run unchanged on top of grid-sourced tiles.
function buildTerrainFromBundle(map, bundle) {
  const profile = terrainProfile(map);
  const cols = bundle.cols;
  const rows = bundle.rows;
  const safeRadiusTiles = map.safeZoneRadius / profile.unitsPerTile;
  const materialRow = (y) => bundle.materialGrid[Math.max(0, Math.min(rows - 1, y))];
  const legend = profile.materials;
  const materialAt = (x, y) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return "grass";
    return legend[parseInt(materialRow(y)[x], 36)] ?? "grass";
  };
  const heightAtVertex = (x, y) =>
    bundle.heights[Math.max(0, Math.min(rows, y))][Math.max(0, Math.min(cols, x))];
  const intHeight = (x, y) =>
    clamp(Math.round(heightAtVertex(x, y)), profile.minElevation, profile.maxElevation);
  const vegetationAt = (x, y) =>
    bundle.vegetation?.[Math.max(0, Math.min(rows - 1, y))]?.[Math.max(0, Math.min(cols - 1, x))] ?? 0.4;

  const centerX = cols / 2;
  const centerY = rows / 2;
  const compositionKits = createTerrainCompositionKits(cols, rows, safeRadiusTiles, profile);
  const tiles = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const gridMaterial = materialAt(x, y);
      const centerDistance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
      const vegetation = vegetationAt(x, y);
      const elevation = clamp((intHeight(x, y) + 1) / 5, 0, 1);
      const biome = {
        elevation,
        moisture: clamp(vegetation * 1.1, 0, 1),
        rockiness: gridMaterial === "rock" ? 0.92 : gridMaterial === "dirt" ? 0.5 : 0.2,
        dryness: clamp(1 - vegetation, 0, 1),
        settlementPressure: clamp(1 - centerDistance / Math.max(0.001, safeRadiusTiles * 0.58), 0, 1),
        plazaPressure: clamp(1 - centerDistance / Math.max(0.001, safeRadiusTiles * 0.42), 0, 1),
        pathPressure: 0,
        northSouthPathPressure: 0,
        eastWestPathPressure: 0,
        shorePathPressure: 0,
        waterPressure: gridMaterial === "water" ? 1 : 0,
        shorePressure: gridMaterial === "water" || gridMaterial === "shore" ? 0.8 : 0,
        vegetation,
        detailDensity: clamp(0.06 + vegetation * 0.3, 0, 1),
      };
      const material = materialForCompositionKit(x, y, gridMaterial, biome, compositionKits);
      const heights =
        material === "water"
          ? { nw: profile.waterLevel, ne: profile.waterLevel, se: profile.waterLevel, sw: profile.waterLevel }
          : material === "settlement"
            ? {
                nw: clamp(intHeight(x, y), 0, 1),
                ne: clamp(intHeight(x + 1, y), 0, 1),
                se: clamp(intHeight(x + 1, y + 1), 0, 1),
                sw: clamp(intHeight(x, y + 1), 0, 1),
              }
            : {
                nw: intHeight(x, y),
                ne: intHeight(x + 1, y),
                se: intHeight(x + 1, y + 1),
                sw: intHeight(x, y + 1),
              };
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
        transitions: transitionsForTile(
          x,
          y,
          material,
          cols,
          rows,
          safeRadiusTiles,
          profile,
          compositionKits,
          materialAt,
        ),
        decals: decalsForTile(x, y, material, profile, biome, composition),
        elevationEdges: [],
      });
    }
  }
  for (const tile of tiles) {
    tile.elevationEdges = elevationEdgesForTile(tile, tiles, cols, rows);
  }
  const worldData = buildWorldDataFromGrids(tiles, cols, rows, bundle.heights, bundle.heathWeights);
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
