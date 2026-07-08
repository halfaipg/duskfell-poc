import { PROJECTION } from "./projection.js";

export function drawFallbackObject(ctx, object, point, footprint, colors) {
  drawFootprint(ctx, point, footprint, colors.fill, colors.stroke);

  ctx.beginPath();
  ctx.arc(point.x, point.y + PROJECTION.halfH * footprint, 10 + 6 * footprint, 0, Math.PI * 2);
  ctx.fillStyle = colors.stroke;
  ctx.fill();

  if (object.kind === "registrar") {
    ctx.fillStyle = "#f4f0e6";
    ctx.fillRect(point.x - 28, point.y - 42, 56, 48);
    ctx.fillStyle = "#b04d36";
    ctx.fillRect(point.x - 34, point.y - 54, 68, 14);
    ctx.fillStyle = "#2f7565";
    ctx.fillRect(point.x - 7, point.y - 20, 14, 26);
  } else if (object.kind === "forge") {
    ctx.fillStyle = "#4b4f53";
    ctx.fillRect(point.x - 26, point.y - 28, 52, 34);
    ctx.fillStyle = "#d98b45";
    ctx.fillRect(point.x - 16, point.y - 18, 32, 12);
    ctx.strokeStyle = "#1d2224";
    ctx.lineWidth = 4;
    ctx.strokeRect(point.x - 26, point.y - 28, 52, 34);
  }
}

export function objectColors(kind) {
  switch (kind) {
    case "registrar":
      return { fill: "rgba(176, 77, 54, 0.2)", stroke: "#b04d36" };
    case "forge":
      return { fill: "rgba(217, 139, 69, 0.26)", stroke: "#9d5d32" };
    case "grove":
      return { fill: "rgba(79, 116, 79, 0.35)", stroke: "#4f744f" };
    case "ore":
      return { fill: "rgba(123, 105, 112, 0.35)", stroke: "#7b6970" };
    case "shrine":
      return { fill: "rgba(244, 240, 230, 0.5)", stroke: "#796c57" };
    case "saplingTree":
      return { fill: "rgba(109, 146, 84, 0.28)", stroke: "#6d9254" };
    case "deadwood":
      return { fill: "rgba(143, 107, 73, 0.26)", stroke: "#8f6b49" };
    case "myceliumPatch":
      return { fill: "rgba(195, 167, 214, 0.24)", stroke: "#8f82b8" };
    case "ruin":
      return { fill: "rgba(157, 150, 127, 0.22)", stroke: "#6f685a" };
    default:
      return { fill: "rgba(22, 26, 29, 0.2)", stroke: "#161a1d" };
  }
}

function drawFootprint(ctx, point, radiusTiles, fill, stroke) {
  ctx.beginPath();
  ctx.ellipse(
    point.x,
    point.y + PROJECTION.halfH * radiusTiles,
    PROJECTION.halfW * radiusTiles,
    PROJECTION.halfH * radiusTiles,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 4;
  ctx.stroke();
}
