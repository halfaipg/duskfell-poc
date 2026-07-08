import { tileBounds } from "./terrain-draw-geometry.js";

export function createTerrainAtlasFrameDrawer({ getContext, getTerrainAssets }) {
  function drawAtlasPatternFrame(frame, corners, alpha) {
    const pattern = terrainPatternForFrame(frame);
    if (!pattern) {
      drawAtlasFrame(frame, corners, alpha);
      return;
    }

    const ctx = getContext();
    const bounds = tileBounds(corners);
    const bleed = 1.25;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = pattern;
    ctx.fillRect(
      bounds.minX - bleed,
      bounds.minY - bleed,
      bounds.maxX - bounds.minX + bleed * 2,
      bounds.maxY - bounds.minY + bleed * 2,
    );
    ctx.globalAlpha = 1;
  }

  function terrainPatternForFrame(frame) {
    const terrainAssets = getTerrainAssets();
    const ctx = getContext();
    const source = terrainAssets.patternSources[frame];
    if (!source) return null;

    let contextPatterns = terrainAssets.patternContexts.get(ctx);
    if (!contextPatterns) {
      contextPatterns = [];
      terrainAssets.patternContexts.set(ctx, contextPatterns);
    }
    if (!contextPatterns[frame]) {
      contextPatterns[frame] = ctx.createPattern(source, "repeat");
    }
    return contextPatterns[frame];
  }

  function drawAtlasFrame(frame, corners, alpha) {
    const terrainAssets = getTerrainAssets();
    const ctx = getContext();
    const image = terrainAssets.image;
    const sheet = terrainAssets.atlas.tileSheet;
    const sx = (frame % sheet.columns) * sheet.cellWidth;
    const sy = Math.floor(frame / sheet.columns) * sheet.cellHeight;
    const bounds = tileBounds(corners);
    const bleed = 1.25;

    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      image,
      sx,
      sy,
      sheet.cellWidth,
      sheet.cellHeight,
      bounds.minX - bleed,
      bounds.minY - bleed,
      bounds.maxX - bounds.minX + bleed * 2,
      bounds.maxY - bounds.minY + bleed * 2,
    );
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = previousSmoothing;
  }

  return {
    drawAtlasFrame,
    drawAtlasPatternFrame,
  };
}
