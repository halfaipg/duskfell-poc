import { createTerrainDebugDrawer, normalizeTerrainDebugMode } from "./terrain-debug-draw.js";
import { drawTerrainDecals } from "./terrain-draw-decals.js";
import { createTerrainAtlasDrawer } from "./terrain-draw-atlas.js";
import { createTerrainLayerManager } from "./terrain-draw-layers.js";
import {
  drawTerrainFacetShade,
  drawTerrainHeightShade,
  drawTerrainReliefEdges,
  drawTerrainSideWalls,
  terrainUnderpaintMaterial,
} from "./terrain-draw-surface.js";
import {
  drawChunkGroundPatch,
  tileUsesGroundPatch,
} from "./terrain-ground-patches.js";
import { TERRAIN_MATERIALS } from "./terrain.js";

export { normalizeTerrainDebugMode };

export function createTerrainDrawer({
  getContext,
  getCanvas,
  getCamera,
  getTerrain,
  getTerrainCacheKey,
  getTerrainAssets,
  getTerrainAssetVersion,
  getTerrainDebugMode,
}) {
  let ctx = getContext();
  let canvas = getCanvas();
  let camera = getCamera();
  let terrain = getTerrain();
  let terrainCacheKey = getTerrainCacheKey();
  let terrainAssets = getTerrainAssets();
  let terrainAssetVersion = getTerrainAssetVersion();
  let terrainDebugMode = getTerrainDebugMode();
  const terrainDebugDrawer = createTerrainDebugDrawer({
    getContext: () => ctx,
    getTerrain: () => terrain,
  });
  const terrainLayerManager = createTerrainLayerManager({
    getCanvas: () => canvas,
    getCamera: () => camera,
    getTerrainAssetVersion: () => terrainAssetVersion,
    getTerrainCacheKey: () => terrainCacheKey,
  });
  const terrainAtlasDrawer = createTerrainAtlasDrawer({
    getContext: () => ctx,
    getTerrainAssets: () => terrainAssets,
  });

  function refreshRendererState() {
    ctx = getContext();
    canvas = getCanvas();
    camera = getCamera();
    terrain = getTerrain();
    terrainCacheKey = getTerrainCacheKey();
    terrainAssets = getTerrainAssets();
    terrainAssetVersion = getTerrainAssetVersion();
    terrainDebugMode = getTerrainDebugMode();
  }

  let lastOrigin = null;

  function drawMap(state, origin, now, viewport) {
    refreshRendererState();
    lastOrigin = origin;
    const worldTerrain = terrain;
    if (!worldTerrain) return;
    const visibleBounds = terrainLayerManager.visibleWorldBounds(viewport);
    const renderGeometry = terrainLayerManager.terrainGeometryForMap(worldTerrain, origin);
    for (const chunk of renderGeometry.chunks) {
      if (!terrainLayerManager.boundsIntersect(chunk.bounds, visibleBounds)) continue;
      if (drawTerrainStaticChunk(chunk)) {
        for (const tileView of chunk.tiles) {
          drawTerrainDynamicTile(tileView, state.tick, now, visibleBounds);
          terrainDebugDrawer.drawTerrainDebugTile(tileView.tile, tileView.corners, terrainDebugMode);
        }
      } else {
        drawChunkGroundPatch(ctx, chunk, origin, worldTerrain, terrainAssets.groundPatches);
        for (const tileView of chunk.tiles) {
          drawTerrainTile(tileView, state.tick, now, visibleBounds);
        }
      }
      terrainDebugDrawer.drawTerrainDebugChunk(chunk, terrainDebugMode);
    }
  }

  function drawTerrainTile(tileView, tick, now, visibleBounds, options = {}) {
    const { drawDynamic = true, drawDebug = true } = options;
    const { tile, corners, bounds } = tileView;
    if (visibleBounds && !terrainLayerManager.boundsIntersect(bounds, visibleBounds)) return;
    const palette = TERRAIN_MATERIALS[terrainUnderpaintMaterial(tile)];

    drawTerrainSideWalls(ctx, tile, corners, palette);

    const groundPatchTile = tileUsesGroundPatch(tile, terrainAssets.groundPatches);
    if (!groundPatchTile) {
      ctx.beginPath();
      ctx.moveTo(corners.nw.x, corners.nw.y);
      ctx.lineTo(corners.ne.x, corners.ne.y);
      ctx.lineTo(corners.se.x, corners.se.y);
      ctx.lineTo(corners.sw.x, corners.sw.y);
      ctx.closePath();
      ctx.fillStyle = palette.fill;
      ctx.fill();
      terrainAtlasDrawer.drawTerrainUnderpaint(tile, corners);
      terrainAtlasDrawer.drawTerrainAtlasTile(tile, corners);
    }
    if (!groundPatchTile) {
      drawTerrainFacetShade(ctx, tile, corners);
      drawTerrainHeightShade(ctx, tile, corners);
    }
    if (!groundPatchTile) {
      drawTerrainReliefEdges(ctx, tile, corners);
    }

    terrainAtlasDrawer.drawTerrainTransitions(tile, corners);
    // painted ground carries its own detail; procedural decals (masonry
    // joints, cracks, tufts) were tuned for flat atlas tiles and read as a
    // lattice on top of the paintings
    if (drawDynamic && !groundPatchTile) {
      drawTerrainDecals(ctx, tile, corners, tick, now);
    }

    if (palette.strokeDebug) {
      ctx.strokeStyle = palette.strokeDebug;
      ctx.lineWidth = 0.45;
      ctx.beginPath();
      ctx.moveTo(corners.nw.x, corners.nw.y);
      ctx.lineTo(corners.ne.x, corners.ne.y);
      ctx.lineTo(corners.se.x, corners.se.y);
      ctx.lineTo(corners.sw.x, corners.sw.y);
      ctx.closePath();
      ctx.stroke();
    }
    if (drawDebug) {
      terrainDebugDrawer.drawTerrainDebugTile(tile, corners, terrainDebugMode);
    }
  }

  function drawTerrainDynamicTile(tileView, tick, now, visibleBounds) {
    const { tile, corners, bounds } = tileView;
    if (visibleBounds && !terrainLayerManager.boundsIntersect(bounds, visibleBounds)) return;
    drawTerrainDecals(ctx, tile, corners, tick, now);
  }

  function drawTerrainStaticChunk(chunk) {
    return terrainLayerManager.drawTerrainStaticChunk(ctx, chunk, (layerContext, staticChunk) => {
      withRenderContext(layerContext, () => {
        drawChunkGroundPatch(ctx, staticChunk, lastOrigin, terrain, terrainAssets.groundPatches);
        for (const tileView of staticChunk.tiles) {
          drawTerrainTile(tileView, 0, 0, null, {
            drawDynamic: false,
            drawDebug: false,
          });
        }
      });
    });
  }

  function withRenderContext(nextContext, drawFn) {
    const previousContext = ctx;
    ctx = nextContext;
    try {
      drawFn();
    } finally {
      ctx = previousContext;
    }
  }

  return {
    drawMap,
  };
}
