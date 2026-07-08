import { projectWorld } from "./projection.js";
import {
  drawDetailShadow,
  drawProceduralTerrainDetail,
} from "./terrain-detail-procedural-draw.js";
import {
  drawTerrainDetailSprite,
  drawTerrainRockDetail,
  treeDetailFrame,
} from "./terrain-detail-sprite-draw.js";
import { terrainDetailOcclusionAlpha, terrainDetailSortBias } from "./terrain-depth.js";

export { drawDetailShadow, treeDetailFrame };

export function createTerrainDetailDrawer({
  getContext,
  getSprites,
  getLocalPlayerRenderPosition,
  cueDrawer,
}) {
  function terrainDetailSortKey(detail, origin) {
    return projectWorld(detail.x, detail.y, detail.z, origin).y + terrainDetailSortBias(detail);
  }

  function drawTerrainDetail(detail, origin) {
    const ctx = getContext();
    const point = projectWorld(detail.x, detail.y, detail.z, origin);
    const alpha = terrainDetailOcclusionAlpha(detail, getLocalPlayerRenderPosition());
    if (alpha < 1) {
      ctx.save();
      ctx.globalAlpha *= alpha;
    }

    const sprites = getSprites();
    const drawn =
      drawTerrainDetailSprite(ctx, sprites, cueDrawer, detail, point) ||
      ((detail.kind === "rock" || detail.kind === "boulder") &&
        drawTerrainRockDetail(ctx, sprites, detail, point)) ||
      drawProceduralTerrainDetail(ctx, detail, point);

    if (!drawn) drawProceduralTerrainDetail(ctx, detail, point);
    if (alpha < 1) ctx.restore();
  }

  return {
    drawTerrainDetail,
    terrainDetailSortKey,
  };
}
