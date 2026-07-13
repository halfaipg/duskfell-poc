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
} from "./terrain-ground-patches.js";
import { PROJECTION } from "./projection.js";
import { TERRAIN_MATERIALS } from "./terrain.js";
import { RENDER_DPR_CAP } from "./device-profile.js";
import { continuousVertexHeight } from "./terrain-height.js";
import { getSun, shadowCast } from "./sun-state.js";
import { CONSTRAINED_DEVICE } from "./device-profile.js";

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
        sun: sun.direction,
        daylight: shadowCast().daylight,
      });
    }
    const waterEntries = glActive ? new Map() : null;
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
      } else {
        // 2D fallback: per-frame canvas shimmer on top of the cached ground
        drawChunkWaterAnimation(ctx, chunk, origin, worldTerrain, terrainAssets.groundPatches, now);
      }
      terrainDebugDrawer.drawTerrainDebugChunk(chunk, terrainDebugMode);
    }
    if (glActive) {
      glLayer.finishTerrain();
      if (waterEntries?.size) {
        drawGlWater(glLayer, waterEntries, origin, now);
      }
      drawGlGrass(glLayer, renderGeometry, visibleBounds, origin, now, viewport);
    }
    return glActive;
  }

  // shader water: one quad per water supertile, masked and animated on the
  // GPU — per-pixel advection, ripple distortion, glints and bank foam
  function drawGlWater(glLayer, waterEntries, origin, now) {
    const waterImage = terrainAssets.groundPatches?.get?.("stream-water") ?? null;
    if (!waterImage) return;
    const { ANIM_SIZE, CANVAS_TILES, PATCH_TILES, MARGIN_TILES } = waterAnimConstants();
    if (!glLayer.beginWater(camera, canvas.clientWidth, canvas.clientHeight, now, waterImage, getSun())) return;
    const { halfW, halfH } = PROJECTION;
    const animPxPerTile = ANIM_SIZE / CANVAS_TILES;
    const a = halfW / animPxPerTile;
    const b = halfH / animPxPerTile;
    for (const entry of waterEntries.values()) {
      const tx = origin.x + (entry.superX - entry.superY) * PATCH_TILES * halfW;
      const ty = origin.y + ((entry.superX + entry.superY) * PATCH_TILES - 2 * MARGIN_TILES) * halfH;
      const corner = (u, v) => ({ x: tx + a * u - a * v, y: ty + b * u + b * v });
      glLayer.drawWaterQuad(
        entry,
        [corner(0, 0), corner(ANIM_SIZE, 0), corner(0, ANIM_SIZE), corner(ANIM_SIZE, ANIM_SIZE)],
        CANVAS_TILES,
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
        const height = continuousVertexHeight(
          x,
          y,
          cols,
          rows,
          worldTerrain.safeRadiusTiles,
          worldTerrain.profile,
        );
        const value = Math.max(0, Math.min(255, Math.round(((height + 1) / 5) * 255)));
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

  // grass blades: deterministic scatter on grassy tiles, wind + shadows on
  // the GPU. Blade geometry lives in cached per-chunk buffers.
  const GRASS_BLADES_PER_TILE = CONSTRAINED_DEVICE ? 5 : 11;

  function drawGlGrass(glLayer, renderGeometry, visibleBounds, origin, now, viewport) {
    const cast = shadowCast();
    if (!glLayer.beginGrass(camera, viewport.width, viewport.height, now, cast, cast.daylight)) {
      return;
    }
    for (const chunk of renderGeometry.chunks) {
      if (!terrainLayerManager.boundsIntersect(chunk.bounds, visibleBounds)) continue;
      const chunkKey = `${terrainCacheKey}:${chunk.x}:${chunk.y}`;
      glLayer.drawGrassChunk(chunkKey, () => buildChunkBlades(chunk));
    }
  }

  function buildChunkBlades(chunk) {
    const blades = [];
    for (const tileView of chunk.tiles) {
      const tile = tileView.tile;
      if (tile.material !== "grass") continue;
      const vegetation = tile.biome?.vegetation ?? 0;
      if (vegetation < 0.3) continue;
      const count = Math.round(vegetation * GRASS_BLADES_PER_TILE);
      const { corners } = tileView;
      for (let index = 0; index < count; index += 1) {
        const u = hash01(tile.x * 31 + index, tile.y * 17 + index * 7);
        const v = hash01(tile.x * 13 + index * 3, tile.y * 41 + index);
        // bilinear across the projected diamond keeps blades on the tile
        const topX = corners.nw.x + (corners.ne.x - corners.nw.x) * u;
        const topY = corners.nw.y + (corners.ne.y - corners.nw.y) * u;
        const botX = corners.sw.x + (corners.se.x - corners.sw.x) * u;
        const botY = corners.sw.y + (corners.se.y - corners.sw.y) * u;
        const x = topX + (botX - topX) * v;
        const y = topY + (botY - topY) * v;
        const height = 5 + hash01(index, tile.x + tile.y) * 8;
        const halfWidth = 0.9 + hash01(index * 5, tile.y) * 0.9;
        const lean = (hash01(tile.x + index, tile.y * 3) - 0.5) * 3;
        const phase = hash01(tile.x * 7, tile.y * 11 + index) * Math.PI * 2;
        const shade = hash01(index * 11, tile.x * 3 + tile.y);
        // one triangle: base-left, base-right, tip
        blades.push(
          x, y, -halfWidth, 0, phase, 0, shade,
          x, y, halfWidth, 0, phase, 0, shade,
          x, y, lean, -height, phase, 1, shade,
        );
      }
    }
    return blades.length ? new Float32Array(blades) : null;
  }

  function hash01(a, b) {
    let h = (Math.imul(a + 101, 374761393) ^ Math.imul(b + 181, 668265263)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
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
    const visibleBounds = terrainLayerManager.visibleWorldBounds(viewport);
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

    drawTerrainSideWalls(ctx, tile, corners, palette, terrainAssets.groundPatches?.get?.("cliff") ?? null);

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
