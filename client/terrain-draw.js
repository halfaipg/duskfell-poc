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
  drawChunkWaterAnimation,
  tileUsesGroundPatch,
  waterAnimConstants,
  waterGroupsForChunk,
} from "./terrain-ground-patches.js?v=duskfell-world-v2-71";
import { PROJECTION } from "./projection.js";
import { TERRAIN_MATERIALS } from "./terrain.js";
import { GRAPHICS_BUDGET, RENDER_DPR_CAP } from "./device-profile.js";
import { getSun, shadowCast } from "./sun-state.js";
import { grassVerticesForChunk } from "./terrain-vertical-slice.js";

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
  getGlLayer = () => null,
  getSun = () => null,
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
    // GPU path: static chunk canvases upload once and draw as quads on the
    // GL canvas below; the 2D context keeps water shimmer, decals and debug
    const glLayer = getGlLayer();
    const glActive = Boolean(
      glLayer && viewport && glLayer.beginFrame(camera, viewport.width, viewport.height, glDpr()),
    );
    if (glActive) {
      const sun = getSun();
      glLayer.setLighting({
        heightsCanvas: heightsCanvasFor(worldTerrain),
        cols: worldTerrain.cols,
        rows: worldTerrain.rows,
        origin,
        sun: sun?.direction,
        daylight: shadowCast().daylight,
        castShadows: GRAPHICS_BUDGET.dynamicTerrainShadows,
      });
    }
    const dynamicWater = GRAPHICS_BUDGET.waterAnimation !== "static";
    const waterEntries = glActive && dynamicWater ? new Map() : null;
    const grassEntries = glActive && GRAPHICS_BUDGET.gpuGrass ? [] : null;
    for (const chunk of renderGeometry.chunks) {
      if (!terrainLayerManager.boundsIntersect(chunk.bounds, visibleBounds)) continue;
      const staticDrawn = glActive
        ? drawTerrainStaticChunkGl(glLayer, chunk)
        : drawTerrainStaticChunk(chunk);
      if (staticDrawn) {
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
      if (waterEntries) {
        for (const entry of waterGroupsForChunk(chunk, worldTerrain, terrainAssets.groundPatches)) {
          waterEntries.set(`${entry.superX}:${entry.superY}`, entry);
        }
        if (grassEntries) {
          const grass = grassVerticesForChunk(chunk, origin, worldTerrain);
          if (grass) grassEntries.push(grass);
        }
      } else if (!glActive && dynamicWater) {
        // 2D fallback: per-frame canvas shimmer on top of the cached ground
        drawChunkWaterAnimation(ctx, chunk, origin, worldTerrain, terrainAssets.groundPatches, now);
      }
      terrainDebugDrawer.drawTerrainDebugChunk(chunk, terrainDebugMode);
    }
    if (glActive) {
      if (grassEntries?.length) {
        glLayer.drawGrass(grassEntries, camera, viewport.width, viewport.height, now, getSun()?.direction);
      }
      glLayer.finishTerrain();
      if (waterEntries?.size) {
        drawGlWater(glLayer, waterEntries, origin, now);
      }
    }
    preloadNextStaticChunk(renderGeometry.chunks, terrainLayerManager.preloadWorldBounds(viewport));
    return glActive;
  }

  function preloadNextStaticChunk(chunks, preloadBounds) {
    for (const chunk of chunks) {
      if (!terrainLayerManager.boundsIntersect(chunk.bounds, preloadBounds)) continue;
      if (terrainLayerManager.hasStaticLayerForChunk(chunk)) continue;
      buildStaticLayer(chunk);
      return;
    }
  }

  // shader water: one quad per water supertile, masked and animated on the
  // GPU — per-pixel advection, ripple distortion, glints and bank foam
  function drawGlWater(glLayer, waterEntries, origin, now) {
    const waterImage = terrainAssets.groundPatches?.get?.("stream-water") ?? null;
    if (!waterImage) return;
    const { ANIM_SIZE, CANVAS_TILES, PATCH_TILES, MARGIN_TILES } = waterAnimConstants();
    if (!glLayer.beginWater(camera, canvas.clientWidth, canvas.clientHeight, now, waterImage, getSun()?.direction)) return;
    const { halfW, halfH } = PROJECTION;
    const animPxPerTile = ANIM_SIZE / CANVAS_TILES;
    const a = halfW / animPxPerTile;
    const b = halfH / animPxPerTile;
    // core-region quads: adjacent supertiles butt exactly instead of
    // overlapping their margin bands (the overlap double-composited into
    // visible cuts); world origin keeps the wave field continuous across
    const coreMin = (ANIM_SIZE * MARGIN_TILES) / CANVAS_TILES;
    const coreMax = ANIM_SIZE - coreMin;
    const uvMin = coreMin / ANIM_SIZE;
    const uvMax = coreMax / ANIM_SIZE;
    for (const entry of waterEntries.values()) {
      const tx = origin.x + (entry.superX - entry.superY) * PATCH_TILES * halfW;
      const ty = origin.y + ((entry.superX + entry.superY) * PATCH_TILES - 2 * MARGIN_TILES) * halfH;
      const corner = (u, v) => ({ x: tx + a * u - a * v, y: ty + b * u + b * v });
      entry.worldOriginX = entry.superX * PATCH_TILES - MARGIN_TILES;
      entry.worldOriginY = entry.superY * PATCH_TILES - MARGIN_TILES;
      glLayer.drawWaterQuad(
        entry,
        [corner(coreMin, coreMin), corner(coreMax, coreMin), corner(coreMin, coreMax), corner(coreMax, coreMax)],
        CANVAS_TILES,
        [uvMin, uvMax],
      );
    }
  }

  // vertex-height grid encoded into a tiny canvas (R = (h+1)/5) for the
  // live hillshade; rebuilt only when the terrain cache key changes
  let heightsCanvas = null;
  let heightsKey = null;

  function heightsCanvasFor(worldTerrain) {
    const key = `${terrainCacheKey}:${worldTerrain.cols}x${worldTerrain.rows}`;
    if (heightsCanvas && heightsKey === key) return heightsCanvas;
    const cols = worldTerrain.cols;
    const rows = worldTerrain.rows;
    const canvas2 = document.createElement("canvas");
    canvas2.width = cols + 1;
    canvas2.height = rows + 1;
    const context = canvas2.getContext("2d");
    if (!context) return null;
    const image = context.createImageData(cols + 1, rows + 1);
    for (let y = 0; y <= rows; y += 1) {
      for (let x = 0; x <= cols; x += 1) {
        const height = worldTerrain.worldData.heightAt(x, y);
        const value = Math.max(0, Math.min(255, Math.round(((height + 1) / 10) * 255)));
        const offset = (y * (cols + 1) + x) * 4;
        image.data[offset] = value;
        image.data[offset + 1] = value;
        image.data[offset + 2] = value;
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    heightsCanvas = canvas2;
    heightsKey = key;
    return heightsCanvas;
  }

  function glDpr() {
    return Math.min(globalThis.devicePixelRatio || 1, RENDER_DPR_CAP);
  }

  function buildStaticLayer(chunk) {
    return terrainLayerManager.staticLayerForChunk(chunk, (layerContext, staticChunk) => {
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

  function drawTerrainStaticChunkGl(glLayer, chunk) {
    const layer = buildStaticLayer(chunk);
    if (!layer) return false;
    return glLayer.drawChunkLayer(layer);
  }

  // incremental first-frame warmup: build ONE visible chunk layer (and its
  // supertile composite) per call so the loading bar keeps moving instead of
  // freezing at 100% while the whole viewport composites in one frame
  let warmKey = null;
  let warmIndex = 0;

  function warmup(origin, viewport) {
    refreshRendererState();
    lastOrigin = origin;
    if (!terrain) return { done: false, built: 0, total: 1 };
    if (warmKey !== `${terrainCacheKey}:${terrainAssetVersion}`) {
      warmKey = `${terrainCacheKey}:${terrainAssetVersion}`;
      warmIndex = 0;
    }
    const visibleBounds = terrainLayerManager.preloadWorldBounds(viewport);
    const geometry = terrainLayerManager.terrainGeometryForMap(terrain, origin);
    const visible = geometry.chunks.filter((chunk) =>
      terrainLayerManager.boundsIntersect(chunk.bounds, visibleBounds),
    );
    if (warmIndex < visible.length) {
      buildStaticLayer(visible[warmIndex]);
      warmIndex += 1;
    }
    return { done: warmIndex >= visible.length, built: warmIndex, total: visible.length };
  }

  function drawTerrainTile(tileView, tick, now, visibleBounds, options = {}) {
    const { drawDynamic = true, drawDebug = true } = options;
    const { tile, corners, bounds } = tileView;
    if (visibleBounds && !terrainLayerManager.boundsIntersect(bounds, visibleBounds)) return;
    const palette = TERRAIN_MATERIALS[terrainUnderpaintMaterial(tile)];
    const groundPatchTile = tileUsesGroundPatch(tile, terrainAssets.groundPatches);

    drawTerrainSideWalls(
      ctx,
      tile,
      corners,
      palette,
      terrainAssets.groundPatches?.get?.("cliff") ?? null,
      terrainAssets.groundPatches?.has?.("__world-painting__") ?? false,
    );

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
    // same rule as the direct path: procedural decals were tuned for flat
    // atlas tiles and scratch dark marks all over the painted ground
    if (tileUsesGroundPatch(tile, terrainAssets.groundPatches)) return;
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
    warmup,
  };
}
