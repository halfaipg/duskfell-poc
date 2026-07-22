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
import { trailFieldAt } from "./terrain-trails.js";

export { TERRAIN_MATERIALS, biomeForTile, materialForTile, terrainHeightMetadata };
export { projectTerrainTile, terrainFacets } from "./terrain-geometry.js";

export function buildTerrain(map, bundle = null) {
  if (bundle?.schema === "duskfell-world-bundle-v2") {
    const placedBundle = bundle.streamingWindow ? bundle : placeV2BundleInMap(bundle, map);
    const visualBiomeWeights = {
      meadow: placedBundle.biomeWeights.meadow,
      heath: placedBundle.biomeWeights.loam,
      chalk: placedBundle.biomeWeights.rock,
      frost: placedBundle.biomeWeights.snow,
      fen: placedBundle.biomeWeights.wetland,
      moor: placedBundle.biomeWeights.loam.map((row) => row.map(() => 0)),
      ash: placedBundle.biomeWeights.loam.map((row) => row.map(() => 0)),
      blight: placedBundle.biomeWeights.loam.map((row) => row.map(() => 0)),
    };
    return buildTerrainFromBundle(map, {
      ...placedBundle.legacy,
      schema: placedBundle.schema,
      fields: placedBundle.fields,
      biomeWeights: visualBiomeWeights,
      materialWeights: placedBundle.materialWeights,
      waterAuthority: placedBundle.waterAuthority,
      dimensions: placedBundle.dimensions,
      worldDimensions: placedBundle.worldDimensions ?? placedBundle.dimensions,
      streamingWindow: placedBundle.streamingWindow ?? null,
      sourceRegion: placedBundle.sourceRegion ?? { offsetX: 0, offsetY: 0, cols: placedBundle.dimensions.cols, rows: placedBundle.dimensions.rows },
    });
  }
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
  const details = visualTerrainDetails(tiles, cols, rows, safeRadiusTiles, profile, compositionKits);
  const detailAuthority = terrainDetailAuthority(
    profile.detailAuthorityEnabled === false ? [] : details,
    profile,
  );
  const chunks = terrainChunks(tiles, cols, rows);
  const interiorSpaces = profile.detailAuthorityEnabled === false
    ? []
    : terrainInteriorSpaces(compositionKits, profile);

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

function placeV2BundleInMap(bundle, map) {
  const unitsPerTile = bundle.dimensions.unitsPerTile;
  const targetCols = Math.ceil(map.width / unitsPerTile);
  const targetRows = Math.ceil(map.height / unitsPerTile);
  const sourceCols = bundle.dimensions.cols;
  const sourceRows = bundle.dimensions.rows;
  if (targetCols === sourceCols && targetRows === sourceRows) return bundle;
  const offsetX = Math.floor((targetCols - sourceCols) / 2);
  const offsetY = Math.floor((targetRows - sourceRows) / 2);
  const sourceX = (x) => clamp(x - offsetX, 0, sourceCols - 1);
  const sourceY = (y) => clamp(y - offsetY, 0, sourceRows - 1);
  const tileGrid = (field) => Array.from({ length: targetRows }, (_, y) =>
    Array.from({ length: targetCols }, (_, x) => field[sourceY(y)][sourceX(x)]),
  );
  const vertexGrid = (field) => Array.from({ length: targetRows + 1 }, (_, y) =>
    Array.from({ length: targetCols + 1 }, (_, x) =>
      field[clamp(y - offsetY, 0, sourceRows)][clamp(x - offsetX, 0, sourceCols)],
    ),
  );
  return {
    ...bundle,
    dimensions: { ...bundle.dimensions, cols: targetCols, rows: targetRows, width: map.width, height: map.height },
    sourceRegion: { offsetX, offsetY, cols: sourceCols, rows: sourceRows },
    fields: Object.fromEntries(Object.entries(bundle.fields).map(([name, field]) => [name, tileGrid(field)])),
    biomeWeights: Object.fromEntries(Object.entries(bundle.biomeWeights).map(([name, field]) => [name, tileGrid(field)])),
    materialWeights: bundle.materialWeights ? {
      ...bundle.materialWeights,
      weights: Object.fromEntries(Object.entries(bundle.materialWeights.weights).map(([name, field]) => [name, tileGrid(field)])),
    } : null,
    waterAuthority: placeWaterAuthority(bundle.waterAuthority, targetCols, targetRows, offsetX, offsetY),
    legacy: {
      ...bundle.legacy,
      cols: targetCols,
      rows: targetRows,
      materialGrid: Array.from({ length: targetRows }, (_, y) => {
        const row = bundle.legacy.materialGrid[sourceY(y)];
        return Array.from({ length: targetCols }, (_, x) => row[sourceX(x)]).join("");
      }),
      heights: vertexGrid(bundle.legacy.heights),
      heathWeights: vertexGrid(bundle.legacy.heathWeights),
      vegetation: tileGrid(bundle.legacy.vegetation),
    },
  };
}

// Bundle worlds: tiles come from baked grids (terrain-diffusion bridge)
// instead of the island formulas. Composition kits, transitions, decals,
// details and chunks run unchanged on top of grid-sourced tiles.
function buildTerrainFromBundle(map, bundle) {
  const profile = terrainProfile(map);
  const cols = bundle.cols;
  const rows = bundle.rows;
  const streaming = Boolean(bundle.streamingWindow);
  const originX = streaming ? bundle.sourceRegion?.offsetX ?? 0 : 0;
  const originY = streaming ? bundle.sourceRegion?.offsetY ?? 0 : 0;
  const worldCols = bundle.worldDimensions?.cols ?? cols;
  const worldRows = bundle.worldDimensions?.rows ?? rows;
  const safeRadiusTiles = map.safeZoneRadius / profile.unitsPerTile;
  const materialRow = (y) => bundle.materialGrid[Math.max(0, Math.min(rows - 1, y))];
  const legend = profile.materials;
  const materialAt = (x, y) => {
    const localX = x - originX;
    const localY = y - originY;
    if (localX < 0 || localY < 0 || localX >= cols || localY >= rows) return "grass";
    return legend[parseInt(materialRow(localY)[localX], 36)] ?? "grass";
  };
  const heightAtVertex = (x, y) => bundle.heights[
    Math.max(0, Math.min(rows, y - originY))
  ][Math.max(0, Math.min(cols, x - originX))];
  const intHeight = (x, y) =>
    clamp(Math.round(heightAtVertex(x, y)), profile.minElevation, profile.maxElevation);
  const vegetationAt = (x, y) =>
    bundle.vegetation?.[Math.max(0, Math.min(rows - 1, y - originY))]?.[Math.max(0, Math.min(cols - 1, x - originX))] ?? 0.4;

  const centerX = worldCols / 2;
  const centerY = worldRows / 2;
  const compositionKits = createTerrainCompositionKits(worldCols, worldRows, safeRadiusTiles, profile);
  const tiles = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const globalX = x + originX;
      const globalY = y + originY;
      const gridMaterial = materialAt(globalX, globalY);
      const centerDistance = Math.hypot(globalX + 0.5 - centerX, globalY + 0.5 - centerY);
      const vegetation = vegetationAt(globalX, globalY);
      const elevation = clamp((intHeight(globalX, globalY) + 1) / 5, 0, 1);
      const trail = trailFieldAt(globalX + 0.5, globalY + 0.5, profile.trails);
      const sourceFields = bundle.fields;
      const sourceAt = (name, fallback) => sourceFields?.[name]?.[y]?.[x] ?? fallback;
      const materialBlend = Object.fromEntries((bundle.materialWeights?.families ?? []).map((name) => [name, bundle.materialWeights.weights[name]?.[y]?.[x] ?? 0]));
      const moisture = sourceAt("moisture", clamp(vegetation * 1.1, 0, 1));
      const waterPressure = Math.max(sourceAt("water", gridMaterial === "water" ? 1 : 0), materialBlend.water ?? 0);
      const humidity = sourceAt("humidity", clamp(moisture * 0.88 + waterPressure * 0.2, 0, 1));
      const windExposure = sourceAt("windExposure", clamp(elevation * 0.35 + ((materialBlend.scree ?? 0) + (materialBlend.cliff ?? 0)) * 0.22, 0, 1));
      const biome = {
        elevation,
        moisture,
        humidity,
        fogPotential: sourceAt("fogPotential", clamp((humidity - 0.48) * 1.55 + waterPressure * 0.3 + (1 - elevation) * 0.12 - windExposure * 0.28, 0, 1)),
        windExposure,
        temperature: sourceAt("temperature", 0.55),
        rockiness: Math.max(sourceAt("rockiness", gridMaterial === "rock" ? 0.92 : gridMaterial === "dirt" ? 0.5 : 0.2), (materialBlend.scree ?? 0) + (materialBlend.cliff ?? 0)),
        snow: sourceAt("snow", 0),
        soil: sourceAt("soil", 0.5),
        dryness: clamp(1 - moisture, 0, 1),
        settlementPressure: clamp(1 - centerDistance / Math.max(0.001, safeRadiusTiles * 0.58), 0, 1),
        plazaPressure: clamp(1 - centerDistance / Math.max(0.001, safeRadiusTiles * 0.42), 0, 1),
        pathPressure: Math.max(trail.pressure, materialBlend.road ?? 0),
        northSouthPathPressure: trail.northSouth,
        eastWestPathPressure: trail.eastWest,
        shorePathPressure: 0,
        waterPressure,
        shorePressure: Math.max(gridMaterial === "water" || gridMaterial === "shore" ? 0.8 : 0, (materialBlend.riverBank ?? 0) + (materialBlend.beach ?? 0)),
        vegetation,
        detailDensity: clamp(0.06 + vegetation * 0.3 - trail.pressure * 0.28, 0, 1),
      };
      const material = materialForCompositionKit(globalX, globalY, gridMaterial, biome, compositionKits);
      const heights =
        material === "water"
          ? { nw: profile.waterLevel, ne: profile.waterLevel, se: profile.waterLevel, sw: profile.waterLevel }
          : material === "settlement"
            ? {
                nw: clamp(intHeight(globalX, globalY), 0, 1),
                ne: clamp(intHeight(globalX + 1, globalY), 0, 1),
                se: clamp(intHeight(globalX + 1, globalY + 1), 0, 1),
                sw: clamp(intHeight(globalX, globalY + 1), 0, 1),
              }
            : {
                nw: intHeight(globalX, globalY),
                ne: intHeight(globalX + 1, globalY),
                se: intHeight(globalX + 1, globalY + 1),
                sw: intHeight(globalX, globalY + 1),
              };
      const height = terrainHeightMetadata(heights);
      const composition = terrainCompositionForTile(
        globalX,
        globalY,
        material,
        biome,
        worldCols,
        worldRows,
        safeRadiusTiles,
        profile,
        height,
        compositionKits,
      );
      const family = terrainFamilyForTile({ x: globalX, y: globalY, material, biome, composition, heights, height });
      tiles.push({
        x: globalX,
        y: globalY,
        material,
        materialWeights: materialBlend,
        biome,
        composition,
        family,
        heights,
        height,
        sloped: height.range > 0,
        transitions: transitionsForTile(
          globalX,
          globalY,
          material,
          worldCols,
          worldRows,
          safeRadiusTiles,
          profile,
          compositionKits,
          materialAt,
        ),
        decals: decalsForTile(globalX, globalY, material, profile, biome, composition),
        elevationEdges: [],
      });
    }
  }
  for (const tile of tiles) {
    tile.elevationEdges = elevationEdgesForTile(tile, tiles, cols, rows, { originX, originY, worldCols, worldRows, emitWorldRim: !streaming });
  }
  const worldData = buildWorldDataFromGrids(tiles, cols, rows, bundle.heights, bundle.heathWeights, bundle.biomeWeights, { x: originX, y: originY });
  const details = streaming
    ? []
    : visualTerrainDetails(tiles, cols, rows, safeRadiusTiles, profile, compositionKits, {
        ambientBounds: bundle.sourceRegion ?? null,
      });
  const detailAuthority = terrainDetailAuthority(
    profile.detailAuthorityEnabled === false ? [] : details,
    profile,
  );
  const chunks = terrainChunks(tiles, cols, rows, { originX, originY });
  const interiorSpaces = profile.detailAuthorityEnabled === false || streaming
    ? []
    : terrainInteriorSpaces(compositionKits, profile);
  const indexedTiles = streaming ? new Array(worldCols * worldRows) : tiles;
  if (streaming) for (const tile of tiles) indexedTiles[tile.y * worldCols + tile.x] = tile;

  return {
    cols: worldCols,
    rows: worldRows,
    loadedCols: cols,
    loadedRows: rows,
    loadedTileOrigin: { x: originX, y: originY },
    worldData,
    width: bundle.worldDimensions?.width ?? bundle.dimensions?.width ?? worldCols * profile.unitsPerTile,
    height: bundle.worldDimensions?.height ?? bundle.dimensions?.height ?? worldRows * profile.unitsPerTile,
    safeRadiusTiles,
    profile,
    compositionKits,
    tiles: indexedTiles,
    loadedTiles: tiles,
    chunks,
    details,
    detailAuthority,
    interiorSpaces,
    materialWeights: bundle.materialWeights ?? null,
    waterAuthority: bundle.waterAuthority ?? null,
    sourceRegion: bundle.sourceRegion ?? null,
    streamingWindow: bundle.streamingWindow ?? null,
  };
}

function visualTerrainDetails(tiles, cols, rows, safeRadiusTiles, profile, compositionKits, options = {}) {
  if (profile.visualDetailEnabled === false) return [];
  const details = terrainDetails(tiles, cols, rows, safeRadiusTiles, profile, compositionKits, options);
  if (profile.detailAuthorityEnabled !== false) return details;
  return details.map((detail) => ({
    ...detail,
    scenicOnly: true,
    authority: null,
    resources: [],
    consumes: [],
    footprint: {
      ...detail.footprint,
      blocksMovement: false,
    },
  }));
}

function placeWaterAuthority(authority, targetCols, targetRows, offsetX, offsetY) {
  if (!authority) return null;
  const samples = authority.samplesPerTile;
  const rows = targetRows * samples;
  const cols = targetCols * samples;
  const sourceOffsetX = offsetX * samples;
  const sourceOffsetY = offsetY * samples;
  const fields = ["wetMask", "surfaceHeight", "depth", "flowDirectionD8", "flowStrength"];
  const placed = Object.fromEntries(fields.map((name) => [name, Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => {
    const sourceX = x - sourceOffsetX;
    const sourceY = y - sourceOffsetY;
    if (sourceX < 0 || sourceY < 0 || sourceX >= authority.cellCols || sourceY >= authority.cellRows) return name === "flowDirectionD8" ? -1 : 0;
    return authority[name][sourceY][sourceX];
  }))]));
  return { ...authority, cellCols: cols, cellRows: rows, ...placed };
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
  const sampledHeight = terrain.worldData?.heightAt?.(mapX, mapY);
  const terrainZ = tile.material === "water"
    ? (terrain.profile?.waterLevel ?? tile.height?.average ?? 0)
    : Number.isFinite(sampledHeight)
      ? sampledHeight
      : bilerp(tile.heights.nw, tile.heights.ne, tile.heights.sw, tile.heights.se, fx, fy);
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
