import { PROJECTION } from "./projection.js";
import { terrainFacets } from "./terrain.js";
import { bandCenter, edgeBandPoints, edgePoints, tintWithAlpha } from "./terrain-draw-geometry.js";

export function terrainUnderpaintMaterial(tile) {
  if (["dirt", "stone", "field", "cobble", "rock", "ruin"].includes(tile.material)) return "grass";
  return tile.material;
}

export function drawTerrainSideWalls(ctx, tile, corners, palette) {
  if (!Array.isArray(tile.elevationEdges) || tile.elevationEdges.length === 0 || tile.material === "water") return;

  for (const edge of tile.elevationEdges) {
    const [from, to] = edgePoints(corners, edge.edge);
    const dropPx = Math.max(2, edge.drop * PROJECTION.zPx);
    const lowerFrom = { x: from.x, y: from.y + dropPx };
    const lowerTo = { x: to.x, y: to.y + dropPx };
    const gradient = ctx.createLinearGradient(
      (from.x + to.x) / 2,
      (from.y + to.y) / 2,
      (lowerFrom.x + lowerTo.x) / 2,
      (lowerFrom.y + lowerTo.y) / 2,
    );
    const shadowAlpha = Math.min(0.52, 0.2 + edge.drop * 0.08);
    gradient.addColorStop(0, tintWithAlpha(palette.dark, shadowAlpha * 0.72));
    gradient.addColorStop(1, `rgba(8, 11, 10, ${shadowAlpha})`);

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineTo(lowerTo.x, lowerTo.y);
    ctx.lineTo(lowerFrom.x, lowerFrom.y);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = "rgba(242, 224, 166, 0.13)";
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }
}

export function drawTerrainFacetShade(ctx, tile, corners) {
  const facets = terrainFacets(tile);
  if (facets.length === 0 || tile.material === "water") return;

  for (const facet of facets) {
    const points = facet.corners.map((corner) => corners[corner]);
    const shadeAlpha = Math.abs(facet.shade) * facet.alpha;
    if (shadeAlpha <= 0.012) continue;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    ctx.fillStyle =
      facet.shade >= 0
        ? `rgba(255, 239, 184, ${Math.min(0.22, shadeAlpha)})`
        : `rgba(12, 16, 14, ${Math.min(0.3, shadeAlpha * 1.2)})`;
    ctx.fill();
  }
}

export function drawTerrainHeightShade(ctx, tile, corners) {
  if (!tile.sloped || tile.material === "water") return;
  const height = tile.height;
  const range = height?.range ?? Math.max(...Object.values(tile.heights)) - Math.min(...Object.values(tile.heights));
  if (range <= 0) return;

  const shade =
    height != null
      ? Math.max(-0.16, Math.min(0.18, (height.light - 0.58) * 0.52))
      : Math.max(
          -0.12,
          Math.min(
            0.18,
            ((tile.heights.sw + tile.heights.se) / 2 - (tile.heights.nw + tile.heights.ne) / 2) * 0.025 +
              ((tile.heights.ne + tile.heights.se) / 2 - (tile.heights.nw + tile.heights.sw) / 2) * 0.018,
          ),
        );
  const alpha = Math.min(0.2, 0.055 + range * 0.025);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners.nw.x, corners.nw.y);
  ctx.lineTo(corners.ne.x, corners.ne.y);
  ctx.lineTo(corners.se.x, corners.se.y);
  ctx.lineTo(corners.sw.x, corners.sw.y);
  ctx.closePath();
  ctx.fillStyle = shade >= 0 ? `rgba(255, 238, 178, ${alpha * shade * 3})` : `rgba(13, 18, 16, ${alpha * Math.abs(shade) * 4})`;
  ctx.fill();
  ctx.restore();
}

export function drawTerrainReliefEdges(ctx, tile, corners) {
  if (!Array.isArray(tile.elevationEdges) || tile.elevationEdges.length === 0) return;

  for (const edge of tile.elevationEdges) {
    const band = edgeBandPoints(corners, edge.edge, reliefBandDepth(edge.drop));
    const alpha = Math.min(0.26, 0.08 + edge.drop * 0.045);
    const [from, to] = edgePoints(corners, edge.edge);
    const center = bandCenter(band);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(band[0].x, band[0].y);
    for (const point of band.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    ctx.clip();

    const gradient = ctx.createLinearGradient((from.x + to.x) / 2, (from.y + to.y) / 2, center.x, center.y);
    gradient.addColorStop(0, `rgba(11, 16, 13, ${alpha})`);
    gradient.addColorStop(0.72, `rgba(11, 16, 13, ${alpha * 0.34})`);
    gradient.addColorStop(1, "rgba(11, 16, 13, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(
      Math.min(...band.map((point) => point.x)) - 1,
      Math.min(...band.map((point) => point.y)) - 1,
      Math.max(...band.map((point) => point.x)) - Math.min(...band.map((point) => point.x)) + 2,
      Math.max(...band.map((point) => point.y)) - Math.min(...band.map((point) => point.y)) + 2,
    );
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = `rgba(244, 226, 164, ${Math.min(0.18, alpha * 0.82)})`;
    ctx.lineWidth = 1.05;
    ctx.stroke();
  }
}

function reliefBandDepth(drop) {
  return Math.min(0.42, 0.22 + drop * 0.065);
}
