import { PROJECTION } from "./projection.js";
import { shouldDrawTerrainDetailAuthorityCue } from "./object-render-policy.js";

export function drawTerrainDetailAuthorityCue(
  ctx,
  cueDrawer,
  object,
  point,
  localPlayerRenderPosition,
  terrainDebugMode,
) {
  if (
    !shouldDrawTerrainDetailAuthorityCue(object, localPlayerRenderPosition, {
      debug: Boolean(terrainDebugMode),
      radius: PROJECTION.unitsPerTile * 2.4,
    })
  ) {
    return;
  }

  const resource = object.resources?.[0];
  if (!resource || resource.maxAmount <= 0) return;
  const fullness = clamp(resource.amount / resource.maxAmount, 0, 1);
  const color = cueDrawer.resourceMeterColor(resource.kind, object.lifecycle);
  const x = Math.round(point.x + 16);
  const y = Math.round(point.y + 26);

  ctx.save();
  ctx.globalAlpha = terrainDebugMode ? 0.84 : 0.58;
  ctx.fillStyle = "rgba(9, 12, 11, 0.5)";
  ctx.beginPath();
  ctx.ellipse(x, y, 8, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y - 1, 2.5 + fullness * 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(246, 239, 217, 0.42)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y - 1, 5.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fullness);
  ctx.stroke();
  ctx.restore();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
