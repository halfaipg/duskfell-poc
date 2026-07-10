import {
  VISUAL_BIOMES,
  activeVisualBiomesForPatch,
  visualBiomeWeightsAt,
} from "./terrain-visual-biomes.js";
import { projectTerrainTile } from "./terrain-geometry.js";
import { terrainTileAt } from "./terrain.js";

const PATCHED_MATERIALS = new Set([
  "grass", "field", "dirt", "stone", "rock", "ruin", "shore", "settlement", "cobble",
]);
const PATCH_TILES = 16;
const PLAN_PX_PER_TILE = 128;
const PATCH_SIZE = PATCH_TILES * PLAN_PX_PER_TILE;
const MASK_SIZE = 192;
const MAX_COMPOSITE_PATCHES = 12;

const compositeCache = new Map();
let activeGroundPatches = null;

function useGroundPatches(groundPatches) {
  if (activeGroundPatches !== groundPatches) {
    activeGroundPatches = groundPatches;
    compositeCache.clear();
  }
  return groundPatches instanceof Map && VISUAL_BIOMES.every((biome) => groundPatches.has(biome));
}

export function tileUsesGroundPatch(tile, groundPatches) {
  if (!tile || !PATCHED_MATERIALS.has(tile.material)) return false;
  // water defers to the atlas (shimmer decals); everything else is painted —
  // roads and plazas are marked by the trampled-earth wear overlay instead
  // of falling back to repeating atlas frames
  if (tile.composition?.zone === "water") return false;
  return useGroundPatches(groundPatches);
}

export function materialHasGroundPatch(material, groundPatches) {
  return PATCHED_MATERIALS.has(material) && useGroundPatches(groundPatches);
}

export function drawChunkGroundPatch(ctx, chunk, origin, terrain, groundPatches) {
  if (!origin || !terrain || !useGroundPatches(groundPatches)) return false;
  let drewPatch = false;
  for (const tileView of chunk.tiles) {
    if (!tileUsesGroundPatch(tileView.tile, groundPatches)) continue;
    const patch = compositePatchForTile(tileView.tile, terrain, groundPatches);
    if (!patch) continue;
    drawPatchTile(ctx, patch, tileView.tile, projectTerrainTile(tileView.tile, origin));
    drewPatch = true;
  }
  return drewPatch;
}

function compositePatchForTile(tile, terrain, groundPatches) {
  const superX = Math.floor(tile.x / PATCH_TILES);
  const superY = Math.floor(tile.y / PATCH_TILES);
  const seed = terrain.profile?.seed ?? 7341;
  const key = `${superX}:${superY}:${terrain.cols}:${terrain.rows}:${seed}`;
  const cached = compositeCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = PATCH_SIZE;
  canvas.height = PATCH_SIZE;
  const composite = canvas.getContext("2d");
  if (!composite) return null;

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = MASK_SIZE;
  maskCanvas.height = MASK_SIZE;
  const maskContext = maskCanvas.getContext("2d");
  if (!maskContext) return null;

  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = PATCH_SIZE;
  layerCanvas.height = PATCH_SIZE;
  const layer = layerCanvas.getContext("2d");
  if (!layer) return null;

  const activeBiomes = activeVisualBiomesForPatch(
    superX,
    superY,
    PATCH_TILES,
    terrain.cols,
    terrain.rows,
    seed,
  );
  for (const [biomeIndex, biome] of activeBiomes.entries()) {
    const image = biomeImageForSupertile(groundPatches, biome);
    if (!image) continue;
    layer.clearRect(0, 0, PATCH_SIZE, PATCH_SIZE);
    layer.globalCompositeOperation = "source-over";
    drawBombedPatchImage(layer, image, superX, superY, seed + VISUAL_BIOMES.indexOf(biome) * 7919);
    writeBiomeMask(maskContext, biome, activeBiomes, superX, superY, terrain.cols, terrain.rows, seed);
    layer.globalCompositeOperation = "destination-in";
    layer.imageSmoothingEnabled = true;
    layer.drawImage(maskCanvas, 0, 0, PATCH_SIZE, PATCH_SIZE);
    layer.globalCompositeOperation = "source-over";
    composite.drawImage(layerCanvas, 0, 0);
  }

  drawRoadWear(composite, maskContext, maskCanvas, superX, superY, terrain);

  compositeCache.set(key, canvas);
  while (compositeCache.size > MAX_COMPOSITE_PATCHES) {
    compositeCache.delete(compositeCache.keys().next().value);
  }
  return canvas;
}

function biomeImageForSupertile(groundPatches, biome) {
  return groundPatches.get(biome) ?? null;
}

// Texture bombing: the painting is scattered as feathered stamps on a
// world-space jittered grid instead of drawn once per supertile (which
// repeated the whole painting every 16 tiles). Stamp parameters hash from
// world grid coordinates, so a stamp straddling a supertile border renders
// identically in both composites — coverage is seamless by construction.
const STAMP_GRID_TILES = 4;
const STAMP_RADIUS_TILES = 3.5;
let stampScratch = null;

function stampScratchContext(sizePx) {
  if (!stampScratch || stampScratch.canvas.width !== sizePx) {
    const canvas = document.createElement("canvas");
    canvas.width = sizePx;
    canvas.height = sizePx;
    stampScratch = canvas.getContext("2d");
  }
  return stampScratch;
}

function drawBombedPatchImage(ctx, image, superX, superY, seed) {
  ctx.imageSmoothingEnabled = true;
  // base coat guarantees full coverage under the feathered stamps;
  // parity mirroring makes it edge-continuous across supertile borders so
  // feather gaps between stamp cores never expose a hard seam
  ctx.save();
  ctx.translate(PATCH_SIZE / 2, PATCH_SIZE / 2);
  ctx.scale(((superX % 2) + 2) % 2 === 0 ? 1 : -1, ((superY % 2) + 2) % 2 === 0 ? 1 : -1);
  ctx.drawImage(image, -PATCH_SIZE / 2, -PATCH_SIZE / 2, PATCH_SIZE, PATCH_SIZE);
  ctx.restore();

  const radiusPx = STAMP_RADIUS_TILES * PLAN_PX_PER_TILE;
  const stampSizePx = Math.ceil(radiusPx * 2);
  const patchTileX = superX * PATCH_TILES;
  const patchTileY = superY * PATCH_TILES;
  const gridMin = (edge) => Math.floor((edge - STAMP_RADIUS_TILES - STAMP_GRID_TILES) / STAMP_GRID_TILES);
  const gridMax = (edge) => Math.ceil((edge + STAMP_RADIUS_TILES + STAMP_GRID_TILES) / STAMP_GRID_TILES);

  for (let gy = gridMin(patchTileY); gy <= gridMax(patchTileY + PATCH_TILES); gy += 1) {
    for (let gx = gridMin(patchTileX); gx <= gridMax(patchTileX + PATCH_TILES); gx += 1) {
      const jitterX = stampHash01(gx, gy, seed + 11);
      const jitterY = stampHash01(gx, gy, seed + 23);
      const centerTileX = (gx + 0.5 + (jitterX - 0.5) * 0.9) * STAMP_GRID_TILES;
      const centerTileY = (gy + 0.5 + (jitterY - 0.5) * 0.9) * STAMP_GRID_TILES;
      const centerPxX = (centerTileX - patchTileX) * PLAN_PX_PER_TILE;
      const centerPxY = (centerTileY - patchTileY) * PLAN_PX_PER_TILE;
      if (
        centerPxX < -radiusPx || centerPxX > PATCH_SIZE + radiusPx ||
        centerPxY < -radiusPx || centerPxY > PATCH_SIZE + radiusPx
      ) continue;

      // dihedral-8 orientation: 90° steps + optional mirror stay
      // pixel-aligned, so repeated resampling never softens the painting
      const orientation = Math.floor(stampHash01(gx, gy, seed + 37) * 8);
      const rotation = (orientation % 4) * (Math.PI / 2);
      const mirrored = orientation >= 4;
      // near-native sampling: source window ≈ destination size, so the
      // painting's 128px/tile detail stays crisp instead of upscaling
      const drawSize = stampSizePx * 1.5;
      const windowScale = 0.9 + stampHash01(gx, gy, seed + 53) * 0.25;
      const windowSize = Math.min(image.width, Math.floor(drawSize * windowScale));
      const windowX = Math.floor(stampHash01(gx, gy, seed + 71) * (image.width - windowSize));
      const windowY = Math.floor(stampHash01(gx, gy, seed + 89) * (image.height - windowSize));

      const scratch = stampScratchContext(stampSizePx);
      scratch.save();
      scratch.clearRect(0, 0, stampSizePx, stampSizePx);
      scratch.globalCompositeOperation = "source-over";
      scratch.imageSmoothingEnabled = true;
      scratch.translate(stampSizePx / 2, stampSizePx / 2);
      scratch.rotate(rotation);
      if (mirrored) scratch.scale(-1, 1);
      // overdraw past the feather radius so orientation never exposes corners
      scratch.drawImage(image, windowX, windowY, windowSize, windowSize, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      scratch.restore();
      const feather = scratch.createRadialGradient(
        stampSizePx / 2, stampSizePx / 2, radiusPx * 0.45,
        stampSizePx / 2, stampSizePx / 2, radiusPx,
      );
      feather.addColorStop(0, "rgba(255,255,255,1)");
      feather.addColorStop(1, "rgba(255,255,255,0)");
      scratch.globalCompositeOperation = "destination-in";
      scratch.fillStyle = feather;
      scratch.fillRect(0, 0, stampSizePx, stampSizePx);

      ctx.drawImage(scratch.canvas, centerPxX - stampSizePx / 2, centerPxY - stampSizePx / 2);
    }
  }
}

// Roads and plaza aprons on painted ground read as trampled earth: a soft
// mask built from tile zones darkens and desaturates the painting along the
// route, so paths stay legible without falling back to atlas ribbons.
function drawRoadWear(composite, maskContext, maskCanvas, superX, superY, terrain) {
  const maskPxPerTile = MASK_SIZE / PATCH_TILES;
  const wearZoneAt = (tx, ty) => {
    const tile = terrainTileAt(terrain, superX * PATCH_TILES + tx, superY * PATCH_TILES + ty);
    const zone = tile?.composition?.zone;
    return zone === "road" || zone === "plaza" ? zone : null;
  };
  let hasWear = false;
  maskContext.save();
  maskContext.globalCompositeOperation = "source-over";
  maskContext.clearRect(0, 0, MASK_SIZE, MASK_SIZE);
  maskContext.strokeStyle = "rgba(255,255,255,0.55)";
  maskContext.fillStyle = "rgba(255,255,255,0.55)";
  maskContext.lineWidth = maskPxPerTile * 1.15;
  maskContext.lineCap = "round";
  // strokes between neighboring wear tiles keep diagonal road chains
  // continuous; isolated tiles (and plazas) still get their disc
  const NEIGHBORS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let ty = -2; ty <= PATCH_TILES + 1; ty += 1) {
    for (let tx = -2; tx <= PATCH_TILES + 1; tx += 1) {
      const zone = wearZoneAt(tx, ty);
      if (!zone) continue;
      hasWear = true;
      const cx = (tx + 0.5) * maskPxPerTile;
      const cy = (ty + 0.5) * maskPxPerTile;
      maskContext.beginPath();
      maskContext.arc(cx, cy, maskPxPerTile * (zone === "plaza" ? 0.8 : 0.6), 0, Math.PI * 2);
      maskContext.fill();
      for (const [dx, dy] of NEIGHBORS) {
        if (!wearZoneAt(tx + dx, ty + dy)) continue;
        maskContext.beginPath();
        maskContext.moveTo(cx, cy);
        maskContext.lineTo((tx + dx + 0.5) * maskPxPerTile, (ty + dy + 0.5) * maskPxPerTile);
        maskContext.stroke();
      }
    }
  }
  maskContext.restore();
  if (!hasWear) return;

  composite.save();
  composite.imageSmoothingEnabled = true;
  composite.globalCompositeOperation = "multiply";
  composite.globalAlpha = 1;
  // multiply pass: packed earth is darker and warmer than the living ground
  composite.fillStyle = "rgb(180, 160, 134)";
  applyMaskedFill(composite, maskCanvas);
  // dusty highlight pass lifts the center back up so it reads worn, not wet
  composite.globalCompositeOperation = "overlay";
  composite.fillStyle = "rgba(224, 204, 170, 0.45)";
  applyMaskedFill(composite, maskCanvas);
  composite.restore();
}

let wearScratch = null;

function applyMaskedFill(composite, maskCanvas) {
  if (!wearScratch) {
    const canvas = document.createElement("canvas");
    canvas.width = PATCH_SIZE;
    canvas.height = PATCH_SIZE;
    wearScratch = canvas.getContext("2d");
  }
  wearScratch.clearRect(0, 0, PATCH_SIZE, PATCH_SIZE);
  wearScratch.globalCompositeOperation = "source-over";
  wearScratch.fillStyle = composite.fillStyle;
  wearScratch.fillRect(0, 0, PATCH_SIZE, PATCH_SIZE);
  wearScratch.globalCompositeOperation = "destination-in";
  wearScratch.imageSmoothingEnabled = true;
  wearScratch.drawImage(maskCanvas, 0, 0, PATCH_SIZE, PATCH_SIZE);
  composite.drawImage(wearScratch.canvas, 0, 0);
}

function stampHash01(x, y, seed) {
  let value = Math.imul(x + 101, 374761393) ^ Math.imul(y + 181, 668265263) ^ Math.imul(seed + 31, 2147483647);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function writeBiomeMask(ctx, biome, activeBiomes, superX, superY, cols, rows, seed) {
  const imageData = ctx.createImageData(MASK_SIZE, MASK_SIZE);
  const data = imageData.data;
  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      const mapX = superX * PATCH_TILES + ((x + 0.5) / MASK_SIZE) * PATCH_TILES;
      const mapY = superY * PATCH_TILES + ((y + 0.5) / MASK_SIZE) * PATCH_TILES;
      const weights = visualBiomeWeightsAt(mapX, mapY, cols, rows, seed);
      const activeTotal = activeBiomes.reduce((sum, activeBiome) => sum + weights[activeBiome], 0) || 1;
      const weight = (weights[biome] ?? 0) / activeTotal;
      const offset = (y * MASK_SIZE + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(weight * 255);
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawPatchTile(ctx, patch, tile, corners) {
  const superX = Math.floor(tile.x / PATCH_TILES);
  const superY = Math.floor(tile.y / PATCH_TILES);
  const u0 = (tile.x - superX * PATCH_TILES) * PLAN_PX_PER_TILE;
  const v0 = (tile.y - superY * PATCH_TILES) * PLAN_PX_PER_TILE;
  const u1 = u0 + PLAN_PX_PER_TILE;
  const v1 = v0 + PLAN_PX_PER_TILE;

  drawTexturedTriangle(ctx, patch, [
    { source: { x: u0, y: v0 }, target: corners.nw },
    { source: { x: u1, y: v0 }, target: corners.ne },
    { source: { x: u1, y: v1 }, target: corners.se },
  ]);
  drawTexturedTriangle(ctx, patch, [
    { source: { x: u0, y: v0 }, target: corners.nw },
    { source: { x: u1, y: v1 }, target: corners.se },
    { source: { x: u0, y: v1 }, target: corners.sw },
  ]);
}

function drawTexturedTriangle(ctx, image, points) {
  const [first, second, third] = points;
  const transform = affineTransform(first, second, third);
  if (!transform) return;
  const clipPoints = expandedTriangle(points.map((point) => point.target), 1.25);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(clipPoints[0].x, clipPoints[0].y);
  ctx.lineTo(clipPoints[1].x, clipPoints[1].y);
  ctx.lineTo(clipPoints[2].x, clipPoints[2].y);
  ctx.closePath();
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.transform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

function expandedTriangle(points, pixels) {
  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
  return points.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: point.x + (dx / length) * pixels,
      y: point.y + (dy / length) * pixels,
    };
  });
}

function affineTransform(first, second, third) {
  const x1 = first.source.x;
  const y1 = first.source.y;
  const x2 = second.source.x;
  const y2 = second.source.y;
  const x3 = third.source.x;
  const y3 = third.source.y;
  const determinant = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2);
  if (Math.abs(determinant) < 0.000001) return null;

  const tx1 = first.target.x;
  const ty1 = first.target.y;
  const tx2 = second.target.x;
  const ty2 = second.target.y;
  const tx3 = third.target.x;
  const ty3 = third.target.y;
  return {
    a: (tx1 * (y2 - y3) + tx2 * (y3 - y1) + tx3 * (y1 - y2)) / determinant,
    b: (ty1 * (y2 - y3) + ty2 * (y3 - y1) + ty3 * (y1 - y2)) / determinant,
    c: (tx1 * (x3 - x2) + tx2 * (x1 - x3) + tx3 * (x2 - x1)) / determinant,
    d: (ty1 * (x3 - x2) + ty2 * (x1 - x3) + ty3 * (x2 - x1)) / determinant,
    e:
      (tx1 * (x2 * y3 - x3 * y2) + tx2 * (x3 * y1 - x1 * y3) + tx3 * (x1 * y2 - x2 * y1)) /
      determinant,
    f:
      (ty1 * (x2 * y3 - x3 * y2) + ty2 * (x3 * y1 - x1 * y3) + ty3 * (x1 * y2 - x2 * y1)) /
      determinant,
  };
}
