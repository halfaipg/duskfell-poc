import { PROJECTION } from "./projection.js";
import { terrainFacets } from "./terrain.js";
import { bandCenter, edgeBandPoints, edgePoints, tintWithAlpha } from "./terrain-draw-geometry.js";

export function terrainUnderpaintMaterial(tile) {
  if (["dirt", "stone", "field", "cobble", "rock", "ruin"].includes(tile.material)) return "grass";
  return tile.material;
}

export function drawTerrainSideWalls(ctx, tile, corners, palette, cliffImage = null, continuousPainting = false) {
  // water included: walls cover the screen-space gap below displaced edges
  // for every material — skipping them leaves black notches at pond steps
  if (!Array.isArray(tile.elevationEdges) || tile.elevationEdges.length === 0) return;

  for (const edge of tile.elevationEdges) {
    // Only real cliffs get a wall; scattered single-tile steps read better
    // from the top painting and the material undercoat beneath it — except
    // on rock, where every bench step is a small cliff band: unpainted
    // 1-step gaps expose 20px of flat undercoat across the whole massif
    const rocky = tile.material === "rock" || tile.material === "stone";
    if (edge.drop < 2 && (!rocky || continuousPainting)) continue;
    const [from, to] = edgePoints(corners, edge.edge);
    const dropPx = Math.max(2, edge.drop * PROJECTION.zPx);
    const lowerFrom = { x: from.x, y: from.y + dropPx };
    const lowerTo = { x: to.x, y: to.y + dropPx };

    const wallPath = () => {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.lineTo(lowerTo.x, lowerTo.y);
      ctx.lineTo(lowerFrom.x, lowerFrom.y);
      ctx.closePath();
    };

    if (cliffImage) {
      // Map a continuous strip of the source painting onto the actual wall
      // basis. Axis-aligned drawImage bounds shear diagonal faces into blurry
      // vertical bands; this affine mapping keeps fracture planes geological.
      ctx.save();
      wallPath();
      ctx.clip();
      const sample = cliffFaceTextureSample(tile, edge, cliffImage);
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = edge.drop >= 2 ? 0.96 : 0.74;
      ctx.transform(
        (to.x - from.x) / sample.width,
        (to.y - from.y) / sample.width,
        0,
        dropPx / sample.height,
        from.x,
        from.y,
      );
      if (sample.reverse) {
        ctx.translate(sample.width, 0);
        ctx.scale(-1, 1);
      }
      drawWrappedCliffStrip(ctx, cliffImage, sample);
      ctx.restore();
    }

    const gradient = ctx.createLinearGradient(
      (from.x + to.x) / 2,
      (from.y + to.y) / 2,
      (lowerFrom.x + lowerTo.x) / 2,
      (lowerFrom.y + lowerTo.y) / 2,
    );
    const orientationShade = edge.edge === "south" ? 1.18 : edge.edge === "east" ? 1.08 : 0.92;
    const shadowAlpha = Math.min(0.25, (0.055 + edge.drop * 0.034) * orientationShade);
    gradient.addColorStop(0, tintWithAlpha(palette.dark, shadowAlpha * (cliffImage ? 0.32 : 0.72)));
    gradient.addColorStop(0.7, `rgba(12, 15, 14, ${shadowAlpha * (cliffImage ? 0.62 : 0.48)})`);
    gradient.addColorStop(1, `rgba(7, 9, 9, ${shadowAlpha * (cliffImage ? 1.45 : 1)})`);
    wallPath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    const ledgeAlpha = edge.drop >= 2 ? 0.09 : 0.025;
    ctx.strokeStyle = `rgba(224, 207, 160, ${ledgeAlpha})`;
    ctx.lineWidth = edge.drop >= 2 ? 0.9 : 0.45;
    ctx.stroke();
  }
}

const CLIFF_SOURCE_PX_PER_TILE = 96;
const CLIFF_SOURCE_MIN_HEIGHT = 384;
const CLIFF_SOURCE_PX_PER_DROP = 160;

export function cliffFaceTextureSample(tile, edge, cliffImage) {
  const horizontal = edge.edge === "north" || edge.edge === "south";
  const along = horizontal ? tile.x : tile.y;
  const cross = horizontal ? tile.y : tile.x;
  const width = Math.min(CLIFF_SOURCE_PX_PER_TILE, cliffImage.width);
  const height = Math.min(
    cliffImage.height,
    Math.max(CLIFF_SOURCE_MIN_HEIGHT, Math.round(edge.drop * CLIFF_SOURCE_PX_PER_DROP)),
  );
  const maxV = Math.max(1, cliffImage.height - height + 1);
  const orientation = ["north", "east", "south", "west"].indexOf(edge.edge);
  return {
    width,
    height,
    sourceX: positiveModulo(along * width, cliffImage.width),
    sourceY: positiveModulo(cross * 211 + Math.max(0, orientation) * 503, maxV),
    reverse: edge.edge === "south" || edge.edge === "west",
  };
}

function drawWrappedCliffStrip(ctx, image, sample) {
  const firstWidth = Math.min(sample.width, image.width - sample.sourceX);
  ctx.drawImage(
    image,
    sample.sourceX,
    sample.sourceY,
    firstWidth,
    sample.height,
    0,
    0,
    firstWidth,
    sample.height,
  );
  const remainder = sample.width - firstWidth;
  if (remainder <= 0) return;
  ctx.drawImage(
    image,
    0,
    sample.sourceY,
    remainder,
    sample.height,
    firstWidth,
    0,
    remainder,
    sample.height,
  );
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
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
        ? `rgba(255, 239, 184, ${Math.min(0.11, shadeAlpha * 0.55)})`
        : `rgba(12, 16, 14, ${Math.min(0.14, shadeAlpha * 0.6)})`;
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
  ctx.fillStyle = shade >= 0 ? `rgba(255, 238, 178, ${alpha * shade * 1.6})` : `rgba(13, 18, 16, ${alpha * Math.abs(shade) * 2.2})`;
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
    ctx.strokeStyle = `rgba(244, 226, 164, ${Math.min(0.07, alpha * 0.3)})`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function reliefBandDepth(drop) {
  return Math.min(0.42, 0.22 + drop * 0.065);
}
