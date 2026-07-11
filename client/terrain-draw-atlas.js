import { shouldUseRaisedTerrainArt } from "./terrain-rendering.js";
import { createTerrainAtlasFrameDrawer } from "./terrain-draw-atlas-frames.js";
import { createTerrainTransitionDrawer } from "./terrain-draw-atlas-transitions.js";
import { clipTile } from "./terrain-draw-geometry.js";

export function createTerrainAtlasDrawer({ getContext, getTerrainAssets }) {
  const frameDrawer = createTerrainAtlasFrameDrawer({ getContext, getTerrainAssets });
  const transitionDrawer = createTerrainTransitionDrawer({
    getContext,
    getTerrainAssets,
    drawAtlasFrame: frameDrawer.drawAtlasFrame,
  });

  function drawTerrainAtlasTile(tile, corners) {
    const terrainAssets = getTerrainAssets();
    const atlasTile =
      shouldUseRaisedTerrainArt(tile)
        ? terrainAssets.atlas?.slopeByMaterial?.get(tile.material) ??
          terrainAssets.atlas?.byMaterial?.get(tile.material)
        : terrainAssets.atlas?.byMaterial?.get(tile.material);
    const image = terrainAssets.image;
    if (!atlasTile || !image?.complete || image.naturalWidth === 0) return false;

    const ctx = getContext();
    ctx.save();
    clipTile(ctx, corners);
    frameDrawer.drawAtlasPatternFrame(atlasTile.frame, corners, terrainAtlasAlpha(tile));
    ctx.restore();
    return true;
  }

  function drawTerrainUnderpaint(tile, corners) {
    if (tile.material === "grass" || tile.material === "water" || tile.material === "settlement") return;
    const terrainAssets = getTerrainAssets();
    const atlasTile = terrainAssets.atlas?.byMaterial?.get("grass");
    const image = terrainAssets.image;
    if (!atlasTile || !image?.complete || image.naturalWidth === 0) return;

    const ctx = getContext();
    ctx.save();
    clipTile(ctx, corners);
    frameDrawer.drawAtlasPatternFrame(atlasTile.frame, corners, 0.74);
    ctx.restore();
  }

  return {
    drawTerrainAtlasTile,
    drawTerrainTransitions: transitionDrawer.drawTerrainTransitions,
    drawTerrainUnderpaint,
  };
}

function terrainAtlasAlpha(tile) {
  const hasMaterialEdge = tile.transitions.length > 0;
  if (tile.material === "dirt") return hasMaterialEdge ? 0.88 : 0.97;
  if (tile.material === "stone") return hasMaterialEdge ? 0.9 : 0.97;
  if (tile.material === "field") return hasMaterialEdge ? 0.86 : 0.95;
  return tile.sloped ? 0.95 : 1.0;
}
