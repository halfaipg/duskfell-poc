import { PROJECTION } from "./projection.js";

export function drawObjectLabel(ctx, object, point, footprint) {
  ctx.fillStyle = "#161a1d";
  ctx.font = "700 18px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(object.label, point.x, point.y + PROJECTION.tileH * footprint + 28);
}

export function drawWorldObjectExtras(cueDrawer, object, point) {
  if (object.kind === "forge") {
    cueDrawer.drawWorldItemIcon("ore", point.x - 42, point.y + 34, 0.48);
    cueDrawer.drawWorldItemIcon("wood", point.x - 14, point.y + 42, 0.46);
    cueDrawer.drawWorldItemIcon("trail-kit", point.x + 18, point.y + 38, 0.5);
    cueDrawer.drawWorldItemIcon("deed", point.x + 48, point.y + 29, 0.44);
    return;
  }
  if (object.kind === "grove") {
    cueDrawer.drawWorldItemIcon("wood", point.x + 34, point.y + 42, 0.45);
    cueDrawer.drawObjectResourceMeter(object, point);
    return;
  }
  if (object.kind === "ore") {
    cueDrawer.drawWorldItemIcon("ore", point.x + 26, point.y + 34, 0.45);
    cueDrawer.drawObjectResourceMeter(object, point);
    return;
  }
  if (object.kind === "fieldCoil") {
    cueDrawer.drawWorldItemIcon("charge", point.x + 28, point.y + 36, 0.4);
    cueDrawer.drawObjectResourceMeter(object, point);
    return;
  }
  if (object.kind === "shrine") {
    cueDrawer.drawWorldItemIcon("deed", point.x + 30, point.y + 32, 0.42);
  }
  if (object.kind === "ruin") {
    cueDrawer.drawWorldItemIcon("stone", point.x + 28, point.y + 38, 0.38);
  }
  cueDrawer.drawObjectResourceMeter(object, point);
}
