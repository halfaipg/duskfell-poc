import { drawTerrainGroundDetail, drawTerrainReedsDetail } from "./terrain-detail-procedural-nature.js";
import {
  drawTerrainFoundationDetail,
  drawTerrainRuinDetail,
  drawTerrainStairsDetail,
  drawTerrainWallDetail,
} from "./terrain-detail-procedural-structures.js";
import { drawTerrainTreeDetail } from "./terrain-detail-procedural-trees.js";
export { drawDetailShadow } from "./terrain-detail-shadow.js";

export function drawProceduralTerrainDetail(ctx, detail, point) {
  if (detail.kind === "tree") {
    drawTerrainTreeDetail(ctx, detail, point);
    return true;
  }
  if (detail.kind === "ruin") {
    drawTerrainRuinDetail(ctx, detail, point);
    return true;
  }
  if (detail.kind === "wall") {
    drawTerrainWallDetail(ctx, detail, point);
    return true;
  }
  if (detail.kind === "stairs") {
    drawTerrainStairsDetail(ctx, detail, point);
    return true;
  }
  if (detail.kind === "foundation") {
    drawTerrainFoundationDetail(ctx, detail, point);
    return true;
  }
  if (detail.kind === "reeds") {
    drawTerrainReedsDetail(ctx, detail, point);
    return true;
  }
  drawTerrainGroundDetail(ctx, detail, point);
  return true;
}
