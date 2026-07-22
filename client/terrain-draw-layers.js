import { PROJECTION } from "./projection.js";
import { projectTerrainTile } from "./terrain.js";
import { GRAPHICS_BUDGET } from "./device-profile.js";

// padding must cover height-displaced diamonds and their wall quads
// (max drop * zPx + patch overlap), or chunk layers crop them into gaps
const TERRAIN_STATIC_CHUNK_PADDING = 64;
const MAX_TERRAIN_STATIC_CHUNK_PIXELS = 1_200_000;
export const TERRAIN_DRAW_OVERSCAN = GRAPHICS_BUDGET.terrainOverscanPx;
export const TERRAIN_PRELOAD_OVERSCAN = GRAPHICS_BUDGET.terrainPreloadOverscanPx;

export function cameraWorldBounds(camera, width, height, padding = 0) {
  return {
    minX: camera.x - padding,
    maxX: camera.x + width / camera.scale + padding,
    minY: camera.y - padding,
    maxY: camera.y + height / camera.scale + padding,
  };
}

export function createTerrainLayerManager({
  getCanvas,
  getCamera,
  getTerrainCacheKey,
  getTerrainAssetVersion,
}) {
  let terrainRenderCacheKey = "";
  let terrainRenderCache = null;

  function visibleWorldBounds(viewport) {
    const canvas = getCanvas();
    const camera = getCamera();
    const width = viewport?.width ?? canvas.clientWidth;
    const height = viewport?.height ?? canvas.clientHeight;
    return cameraWorldBounds(camera, width, height, TERRAIN_DRAW_OVERSCAN);
  }

  function preloadWorldBounds(viewport) {
    const canvas = getCanvas();
    const camera = getCamera();
    const width = viewport?.width ?? canvas.clientWidth;
    const height = viewport?.height ?? canvas.clientHeight;
    return cameraWorldBounds(camera, width, height, TERRAIN_PRELOAD_OVERSCAN);
  }

  function terrainGeometryForMap(worldTerrain, origin) {
    const key = `${getTerrainCacheKey()}:${origin.x}:${origin.y}`;
    if (terrainRenderCacheKey === key && terrainRenderCache?.terrain === worldTerrain) {
      return terrainRenderCache;
    }

    const sourceChunks = Array.isArray(worldTerrain.chunks)
      ? worldTerrain.chunks
      : [{ x: 0, y: 0, cols: worldTerrain.cols, rows: worldTerrain.rows, tiles: worldTerrain.tiles }];
    const chunks = sourceChunks.map((chunk) => {
      let bounds = null;
      const tiles = chunk.tiles.map((tile) => {
        const corners = expandedTerrainCorners(projectTerrainTile(tile, origin), 0.78);
        const tileBounds = projectedTileBounds(corners, tile);
        bounds = mergeBounds(bounds, tileBounds);
        return {
          tile,
          corners,
          bounds: tileBounds,
        };
      });
      return {
        x: chunk.x,
        y: chunk.y,
        cols: chunk.cols,
        rows: chunk.rows,
        bounds: bounds ?? { minX: 0, maxX: 0, minY: 0, maxY: 0 },
        staticLayer: null,
        tiles,
      };
    });

    terrainRenderCacheKey = key;
    terrainRenderCache = {
      terrain: worldTerrain,
      chunks,
    };
    return terrainRenderCache;
  }

  function drawTerrainStaticChunk(ctx, chunk, renderStaticLayer) {
    const layer = terrainStaticLayerForChunk(chunk, renderStaticLayer);
    if (!layer) return false;
    ctx.drawImage(layer.canvas, layer.x, layer.y, layer.width, layer.height);
    return true;
  }

  function terrainStaticLayerForChunk(chunk, renderStaticLayer) {
    if (hasStaticLayerForChunk(chunk)) {
      return chunk.staticLayer;
    }

    const bounds = chunk.bounds;
    const x = Math.floor(bounds.minX - TERRAIN_STATIC_CHUNK_PADDING);
    const y = Math.floor(bounds.minY - TERRAIN_STATIC_CHUNK_PADDING);
    const width = Math.ceil(bounds.maxX - bounds.minX + TERRAIN_STATIC_CHUNK_PADDING * 2);
    const height = Math.ceil(bounds.maxY - bounds.minY + TERRAIN_STATIC_CHUNK_PADDING * 2);
    if (width <= 0 || height <= 0 || width * height > MAX_TERRAIN_STATIC_CHUNK_PIXELS) {
      chunk.staticLayer = null;
      return null;
    }

    const layerCanvas = document.createElement("canvas");
    layerCanvas.width = width;
    layerCanvas.height = height;
    const layerContext = layerCanvas.getContext("2d");
    if (!layerContext) {
      chunk.staticLayer = null;
      return null;
    }

    layerContext.clearRect(0, 0, width, height);
    layerContext.translate(-x, -y);
    renderStaticLayer(layerContext, chunk);

    chunk.staticLayer = {
      assetVersion: getTerrainAssetVersion(),
      terrainKey: terrainRenderCacheKey,
      canvas: layerCanvas,
      x,
      y,
      width,
      height,
    };
    return chunk.staticLayer;
  }

  function hasStaticLayerForChunk(chunk) {
    return (
      chunk.staticLayer?.assetVersion === getTerrainAssetVersion() &&
      chunk.staticLayer?.terrainKey === terrainRenderCacheKey
    );
  }

  return {
    boundsIntersect,
    drawTerrainStaticChunk,
    hasStaticLayerForChunk,
    preloadWorldBounds,
    staticLayerForChunk: terrainStaticLayerForChunk,
    terrainGeometryForMap,
    visibleWorldBounds,
  };
}

function projectedTileBounds(corners, tile) {
  const skirtDrop = Math.max(0, ...(tile.elevationEdges ?? []).map((edge) => edge.drop)) * PROJECTION.zPx;
  return {
    minX: Math.min(corners.nw.x, corners.ne.x, corners.se.x, corners.sw.x) - 4,
    maxX: Math.max(corners.nw.x, corners.ne.x, corners.se.x, corners.sw.x) + 4,
    minY: Math.min(corners.nw.y, corners.ne.y, corners.se.y, corners.sw.y) - 4,
    maxY: Math.max(corners.nw.y, corners.ne.y, corners.se.y, corners.sw.y) + skirtDrop + 4,
  };
}

function mergeBounds(first, second) {
  if (!first) return second;
  return {
    minX: Math.min(first.minX, second.minX),
    maxX: Math.max(first.maxX, second.maxX),
    minY: Math.min(first.minY, second.minY),
    maxY: Math.max(first.maxY, second.maxY),
  };
}

function boundsIntersect(a, b) {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

function expandedTerrainCorners(corners, pixels) {
  const center = {
    x: (corners.nw.x + corners.ne.x + corners.se.x + corners.sw.x) / 4,
    y: (corners.nw.y + corners.ne.y + corners.se.y + corners.sw.y) / 4,
  };
  return Object.fromEntries(
    Object.entries(corners).map(([name, point]) => {
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const length = Math.hypot(dx, dy) || 1;
      return [
        name,
        {
          x: point.x + (dx / length) * pixels,
          y: point.y + (dy / length) * pixels,
        },
      ];
    }),
  );
}
