import {
  VISUAL_BIOMES,
  activeVisualBiomesForPatch,
  visualBiomeWeightsAt,
} from "./terrain-visual-biomes.js";
import { projectTerrainTile } from "./terrain-geometry.js";
import { terrainTileAt } from "./terrain.js";
import { PROJECTION } from "./projection.js";
import { edgePoints } from "./terrain-draw-geometry.js";

const PATCHED_MATERIALS = new Set([
  "grass", "field", "dirt", "stone", "rock", "ruin", "shore", "settlement", "cobble",
  // water is painted into the composite too (sand rim + dark body) — the
  // teal atlas diamonds read as stickers on the painting
  "water",
]);
const PATCH_TILES = 16;
const PLAN_PX_PER_TILE = 128;
const PATCH_SIZE = PATCH_TILES * PLAN_PX_PER_TILE;
const MASK_SIZE = 192;
const MAX_COMPOSITE_PATCHES = 24;

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
  return useGroundPatches(groundPatches);
}

export function materialHasGroundPatch(material, groundPatches) {
  return PATCHED_MATERIALS.has(material) && useGroundPatches(groundPatches);
}

export function drawChunkGroundPatch(ctx, chunk, origin, terrain, groundPatches) {
  if (!origin || !terrain || !useGroundPatches(groundPatches)) return false;
  // group by supertile so each patch draws once through ONE global
  // plan→screen transform: every tile samples the same continuous
  // projection, so slopes never crease the painting with per-triangle
  // shear seams — elevation reads from side walls and displaced clip
  // diamonds instead
  const groups = new Map();
  for (const tileView of chunk.tiles) {
    if (!tileUsesGroundPatch(tileView.tile, groundPatches)) continue;
    const superX = Math.floor(tileView.tile.x / PATCH_TILES);
    const superY = Math.floor(tileView.tile.y / PATCH_TILES);
    const key = `${superX}:${superY}`;
    if (!groups.has(key)) groups.set(key, { superX, superY, tiles: [] });
    groups.get(key).tiles.push(tileView.tile);
  }
  let drewPatch = false;
  for (const group of groups.values()) {
    const patch = compositePatchForTile(group.tiles[0], terrain, groundPatches);
    if (!patch) continue;
    drawPatchGroup(ctx, patch, group, origin);
    drewPatch = true;
  }
  return drewPatch;
}

function drawPatchGroup(ctx, patch, group, origin) {
  const { halfW, halfH } = PROJECTION;
  const planScaleX = halfW / PLAN_PX_PER_TILE;
  const planScaleY = halfH / PLAN_PX_PER_TILE;
  // inflating each diamond hides sub-threshold step gaps (elevationEdges
  // skips drops < 0.75, up to ~4.5px of exposed base): overlapping the
  // same continuous painting is invisible, so generous overlap is free
  const INFLATE = 10;
  ctx.save();
  ctx.beginPath();
  for (const tile of group.tiles) {
    const corners = projectTerrainTile(tile, origin);
    ctx.moveTo(corners.nw.x, corners.nw.y - INFLATE);
    ctx.lineTo(corners.ne.x + INFLATE, corners.ne.y);
    ctx.lineTo(corners.se.x, corners.se.y + INFLATE);
    ctx.lineTo(corners.sw.x - INFLATE, corners.sw.y);
    ctx.closePath();
    // neighbor heights step at elevation edges, leaving screen-space gaps
    // below this tile's displaced edge — include those wall quads so the
    // painting drapes down the step face (side-wall shading tints it after)
    if (Array.isArray(tile.elevationEdges)) {
      for (const edge of tile.elevationEdges) {
        const [from, to] = edgePoints(corners, edge.edge);
        const dropPx = Math.max(2, edge.drop * PROJECTION.zPx) + 0.75;
        // extend both directions: the gap sits below south/east edges but
        // above north/west edges — overdraw is continuous painting anyway
        ctx.moveTo(from.x, from.y - dropPx);
        ctx.lineTo(to.x, to.y - dropPx);
        ctx.lineTo(to.x, to.y + dropPx);
        ctx.lineTo(from.x, from.y + dropPx);
        ctx.closePath();
      }
    }
  }
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.transform(
    planScaleX,
    planScaleY,
    -planScaleX,
    planScaleY,
    origin.x + (group.superX - group.superY) * PATCH_TILES * halfW,
    origin.y + (group.superX + group.superY) * PATCH_TILES * halfH,
  );
  ctx.drawImage(patch, 0, 0);
  ctx.restore();
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
  drawWaterBodies(composite, maskContext, maskCanvas, superX, superY, terrain);

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
  // dusty highlight pass lifts the center back up so it reads worn, not
  // wet — soft-light stays gentle over dark biomes where overlay glows
  composite.globalCompositeOperation = "soft-light";
  composite.fillStyle = "rgba(224, 204, 170, 0.5)";
  applyMaskedFill(composite, maskCanvas);
  composite.restore();
}

// Water paints into the composite as three soft masked passes — wet sand
// rim, water body, deep center — so ponds sit IN the ground painting with
// organic edges instead of hard atlas diamonds.
function drawWaterBodies(composite, maskContext, maskCanvas, superX, superY, terrain) {
  const maskPxPerTile = MASK_SIZE / PATCH_TILES;
  const isWaterAt = (tx, ty) =>
    terrainTileAt(terrain, superX * PATCH_TILES + tx, superY * PATCH_TILES + ty)?.material === "water";
  const passes = [
    { radius: 1.05, alpha: 0.55, color: "rgb(196, 178, 138)", opacity: 0.85 },
    { radius: 0.72, alpha: 0.8, color: "rgb(43, 66, 62)", opacity: 0.94 },
    { radius: 0.4, alpha: 0.9, color: "rgb(28, 46, 48)", opacity: 0.9 },
  ];
  let hasWater = false;
  for (const pass of passes) {
    maskContext.save();
    maskContext.globalCompositeOperation = "source-over";
    maskContext.clearRect(0, 0, MASK_SIZE, MASK_SIZE);
    maskContext.fillStyle = `rgba(255,255,255,${pass.alpha})`;
    maskContext.strokeStyle = `rgba(255,255,255,${pass.alpha})`;
    maskContext.lineWidth = maskPxPerTile * pass.radius * 1.6;
    maskContext.lineCap = "round";
    for (let ty = -2; ty <= PATCH_TILES + 1; ty += 1) {
      for (let tx = -2; tx <= PATCH_TILES + 1; tx += 1) {
        if (!isWaterAt(tx, ty)) continue;
        hasWater = true;
        const cx = (tx + 0.5) * maskPxPerTile;
        const cy = (ty + 0.5) * maskPxPerTile;
        maskContext.beginPath();
        maskContext.arc(cx, cy, maskPxPerTile * pass.radius, 0, Math.PI * 2);
        maskContext.fill();
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
          if (!isWaterAt(tx + dx, ty + dy)) continue;
          maskContext.beginPath();
          maskContext.moveTo(cx, cy);
          maskContext.lineTo((tx + dx + 0.5) * maskPxPerTile, (ty + dy + 0.5) * maskPxPerTile);
          maskContext.stroke();
        }
      }
    }
    maskContext.restore();
    if (!hasWater) return;
    composite.save();
    composite.globalAlpha = pass.opacity;
    composite.fillStyle = pass.color;
    applyMaskedFill(composite, maskCanvas);
    composite.restore();
  }
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

