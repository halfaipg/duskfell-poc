import {
  VISUAL_BIOMES,
  activeVisualBiomesForPatch,
  visualBiomeWeightsAt,
} from "./terrain-visual-biomes.js";
import { projectTerrainTile } from "./terrain-geometry.js";
import { TERRAIN_MATERIALS, terrainTileAt } from "./terrain.js";
import { PROJECTION } from "./projection.js";

const PATCHED_MATERIALS = new Set([
  "grass", "field", "dirt", "stone", "rock", "ruin", "shore", "settlement", "cobble",
  // water is painted into the composite too (sand rim + dark body) — the
  // teal atlas diamonds read as stickers on the painting
  "water",
]);
const PATCH_TILES = 16;
const PLAN_PX_PER_TILE = 128;
const PATCH_SIZE = PATCH_TILES * PLAN_PX_PER_TILE;
// composites render with a 1-tile world-space margin so inflated clip
// diamonds at supertile borders sample real painting instead of leaking
// the flat underpaint (bombing is world-deterministic, so margin content
// matches what the neighbouring supertile draws)
const MARGIN_TILES = 1;
const MARGIN_PX = MARGIN_TILES * PLAN_PX_PER_TILE;
const CANVAS_TILES = PATCH_TILES + MARGIN_TILES * 2;
const CANVAS_SIZE = CANVAS_TILES * PLAN_PX_PER_TILE;
const MASK_SIZE = 216;
const MAX_COMPOSITE_PATCHES = 16;

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
  // Static chunk canvases and height-displaced clip diamonds can leave tiny
  // uncovered wedges at their shared boundaries. Paint a material-colored
  // safety coat first so those subpixel gaps never expose the black canvas.
  drawPatchUnderpaint(ctx, chunk);
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

function drawPatchUnderpaint(ctx, chunk) {
  for (const tileView of chunk.tiles) {
    if (!PATCHED_MATERIALS.has(tileView.tile.material)) continue;
    const { nw, ne, se, sw } = tileView.corners;
    const palette = TERRAIN_MATERIALS[tileView.tile.material] ?? TERRAIN_MATERIALS.grass;
    ctx.beginPath();
    ctx.moveTo(nw.x, nw.y);
    ctx.lineTo(ne.x, ne.y);
    ctx.lineTo(se.x, se.y);
    ctx.lineTo(sw.x, sw.y);
    ctx.closePath();
    ctx.fillStyle = palette.fill;
    ctx.fill();
  }
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
  }
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.transform(
    planScaleX,
    planScaleY,
    -planScaleX,
    planScaleY,
    origin.x + (group.superX - group.superY) * PATCH_TILES * halfW,
    origin.y + ((group.superX + group.superY) * PATCH_TILES - 2 * MARGIN_TILES) * halfH,
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
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const composite = canvas.getContext("2d");
  if (!composite) return null;

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = MASK_SIZE;
  maskCanvas.height = MASK_SIZE;
  const maskContext = maskCanvas.getContext("2d");
  if (!maskContext) return null;

  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = CANVAS_SIZE;
  layerCanvas.height = CANVAS_SIZE;
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
    layer.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    layer.globalCompositeOperation = "source-over";
    drawBombedPatchImage(layer, image, superX, superY, seed + VISUAL_BIOMES.indexOf(biome) * 7919);
    writeBiomeMask(maskContext, biome, activeBiomes, superX, superY, terrain.cols, terrain.rows, seed);
    layer.globalCompositeOperation = "destination-in";
    layer.imageSmoothingEnabled = true;
    layer.drawImage(maskCanvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    layer.globalCompositeOperation = "source-over";
    composite.drawImage(layerCanvas, 0, 0);
  }

  // stacked per-biome masks sum below full opacity at ecotones (1-Π(1-wᵢ)),
  // letting the flat underpaint bleed through as solid ribbons — an opaque
  // dominant-biome coat underneath guarantees alpha 1 everywhere
  const dominantImage = activeBiomes.length ? biomeImageForSupertile(groundPatches, activeBiomes[0]) : null;
  if (dominantImage) {
    composite.globalCompositeOperation = "destination-over";
    drawBombedPatchImage(composite, dominantImage, superX, superY, seed + VISUAL_BIOMES.indexOf(activeBiomes[0]) * 7919);
    composite.globalCompositeOperation = "source-over";
  }

  drawEcotoneBand(composite, maskContext, maskCanvas, superX, superY, terrain, groundPatches);
  drawRoadWear(composite, maskContext, maskCanvas, superX, superY, terrain, groundPatches);
  drawWaterBodies(composite, maskContext, maskCanvas, superX, superY, terrain, groundPatches);

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
  for (let ny = -1; ny <= 1; ny += 1) {
    for (let nx = -1; nx <= 1; nx += 1) {
      ctx.save();
      ctx.translate(
        MARGIN_PX + nx * PATCH_SIZE + PATCH_SIZE / 2,
        MARGIN_PX + ny * PATCH_SIZE + PATCH_SIZE / 2,
      );
      ctx.scale((((superX + nx) % 2) + 2) % 2 === 0 ? 1 : -1, (((superY + ny) % 2) + 2) % 2 === 0 ? 1 : -1);
      ctx.drawImage(image, -PATCH_SIZE / 2, -PATCH_SIZE / 2, PATCH_SIZE, PATCH_SIZE);
      ctx.restore();
    }
  }

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
      const centerPxX = (centerTileX - patchTileX) * PLAN_PX_PER_TILE + MARGIN_PX;
      const centerPxY = (centerTileY - patchTileY) * PLAN_PX_PER_TILE + MARGIN_PX;
      if (
        centerPxX < -radiusPx || centerPxX > CANVAS_SIZE + radiusPx ||
        centerPxY < -radiusPx || centerPxY > CANVAS_SIZE + radiusPx
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

// The biome border wears an enriched ecotone painting: scrub, stones and
// trampled fringes stamped along the band where meadow gives way to heath,
// so the transition carries img2img richness instead of a bare mask blend.
function drawEcotoneBand(composite, maskContext, maskCanvas, superX, superY, terrain, groundPatches) {
  const ecotoneImage = groundPatches?.get("ecotone") ?? null;
  if (!ecotoneImage) return;
  const seed = terrain.profile?.seed ?? 7341;
  const imageData = maskContext.createImageData(MASK_SIZE, MASK_SIZE);
  const data = imageData.data;
  let hasBand = false;
  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      const mapX = superX * PATCH_TILES + ((x + 0.5) / MASK_SIZE) * CANVAS_TILES - MARGIN_TILES;
      const mapY = superY * PATCH_TILES + ((y + 0.5) / MASK_SIZE) * CANVAS_TILES - MARGIN_TILES;
      const weights = visualBiomeWeightsAt(mapX, mapY, terrain.cols, terrain.rows, seed);
      const heath = weights.heath ?? 0;
      // bump centered on the 50/50 line, ragged at both edges
      const rag =
        wearNoise(mapX * 0.7, mapY * 0.7, 211) * 0.7 +
        wearNoise(mapX * 2.1, mapY * 2.1, 241) * 0.3;
      const bump = clamp01((0.40 - Math.abs(heath - 0.5)) / 0.40 + (rag - 0.5) * 0.5);
      const alpha = Math.pow(bump, 1.4) * 0.85;
      if (alpha > 0.02) hasBand = true;
      const offset = (y * MASK_SIZE + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  if (!hasBand) return;
  maskContext.putImageData(imageData, 0, 0);
  composite.save();
  composite.imageSmoothingEnabled = true;
  composite.globalCompositeOperation = "source-over";
  applyMaskedImage(composite, maskCanvas, ecotoneImage, superX, superY);
  composite.restore();
}

// Roads and plaza aprons on painted ground read as trampled earth: a soft
// mask built from tile zones darkens and desaturates the painting along the
// route, so paths stay legible without falling back to atlas ribbons.
function drawRoadWear(composite, maskContext, maskCanvas, superX, superY, terrain, groundPatches) {
  const maskPxPerTile = MASK_SIZE / CANVAS_TILES;
  const wearZoneAt = (tx, ty) => {
    const tile = terrainTileAt(terrain, superX * PATCH_TILES + tx, superY * PATCH_TILES + ty);
    const zone = tile?.composition?.zone;
    return zone === "road" || zone === "plaza" ? zone : null;
  };
  let hasWear = false;
  maskContext.save();
  maskContext.globalCompositeOperation = "source-over";
  maskContext.clearRect(0, 0, MASK_SIZE, MASK_SIZE);
  // two-pass strokes: a wide low-alpha halo gives the ragged pass a soft
  // band to bite into (fringe), the full-alpha core stays solid trail
  const NEIGHBORS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const pass of [
    { alpha: 0.5, width: 1.05, disc: 0.68 },
    { alpha: 1.0, width: 0.55, disc: 0.36 },
  ]) {
    maskContext.strokeStyle = `rgba(255,255,255,${pass.alpha})`;
    maskContext.fillStyle = `rgba(255,255,255,${pass.alpha})`;
    maskContext.lineWidth = maskPxPerTile * pass.width;
    maskContext.lineCap = "round";
    for (let ty = -2; ty <= PATCH_TILES + 1; ty += 1) {
      for (let tx = -2; tx <= PATCH_TILES + 1; tx += 1) {
        const zone = wearZoneAt(tx, ty);
        if (!zone) continue;
        hasWear = true;
        const cx = (tx + MARGIN_TILES + 0.5) * maskPxPerTile;
        const cy = (ty + MARGIN_TILES + 0.5) * maskPxPerTile;
        maskContext.beginPath();
        maskContext.arc(cx, cy, maskPxPerTile * pass.disc * (zone === "plaza" ? 1.35 : 1), 0, Math.PI * 2);
        maskContext.fill();
        for (const [dx, dy] of NEIGHBORS) {
          if (!wearZoneAt(tx + dx, ty + dy)) continue;
          maskContext.beginPath();
          maskContext.moveTo(cx, cy);
          maskContext.lineTo((tx + dx + MARGIN_TILES + 0.5) * maskPxPerTile, (ty + dy + MARGIN_TILES + 0.5) * maskPxPerTile);
          maskContext.stroke();
        }
      }
    }
  }
  maskContext.restore();
  if (!hasWear) return;
  raggedizeWearMask(maskContext, superX, superY);

  composite.save();
  composite.imageSmoothingEnabled = true;
  composite.globalAlpha = 1;
  const trailImage = groundPatches?.get("trail") ?? null;
  if (trailImage) {
    // stamp the packed-dirt PAINTING through the mask — the mockup trails
    // are texture, not tint; parity mirroring keeps it world-continuous
    composite.globalCompositeOperation = "source-over";
    composite.globalAlpha = 0.94;
    applyMaskedImage(composite, maskCanvas, trailImage, superX, superY);
    composite.globalAlpha = 1;
    composite.globalCompositeOperation = "multiply";
    composite.fillStyle = "rgba(196, 180, 158, 0.35)";
    applyMaskedFill(composite, maskCanvas);
  } else {
    composite.globalCompositeOperation = "source-over";
    composite.fillStyle = "rgba(107, 86, 63, 0.82)";
    applyMaskedFill(composite, maskCanvas);
  }
  composite.restore();
}

// Water paints into the composite as three soft masked passes — wet sand
// rim, water body, deep center — so ponds sit IN the ground painting with
// organic edges instead of hard atlas diamonds.
function drawWaterBodies(composite, maskContext, maskCanvas, superX, superY, terrain, groundPatches) {
  const maskPxPerTile = MASK_SIZE / CANVAS_TILES;
  const isWaterAt = (tx, ty) => {
    const material = terrainTileAt(terrain, superX * PATCH_TILES + tx, superY * PATCH_TILES + ty)?.material;
    // ford tiles are "shore": they stay dry gravel bars inside the channel,
    // wrapped by the sand-rim pass, so crossings read shallow and walkable
    return material === "water" ? material : null;
  };
  const waterImage = groundPatches?.get("stream-water") ?? null;
  const passes = [
    { radius: 1.05, alpha: 0.55, color: "rgb(196, 178, 138)", opacity: 0.85, materials: ["water"], kind: "fill" },
    { radius: 0.72, alpha: 0.8, color: "rgb(43, 66, 62)", opacity: 0.94, materials: ["water"], kind: "body" },
    { radius: 0.4, alpha: 0.9, color: "rgb(28, 46, 48)", opacity: 0.55, materials: ["water"], kind: "fill" },
  ];
  for (const pass of passes) {
    let hasWater = false;
    maskContext.save();
    maskContext.globalCompositeOperation = "source-over";
    maskContext.clearRect(0, 0, MASK_SIZE, MASK_SIZE);
    maskContext.fillStyle = `rgba(255,255,255,${pass.alpha})`;
    maskContext.strokeStyle = `rgba(255,255,255,${pass.alpha})`;
    maskContext.lineWidth = maskPxPerTile * pass.radius * 1.6;
    maskContext.lineCap = "round";
    for (let ty = -2; ty <= PATCH_TILES + 1; ty += 1) {
      for (let tx = -2; tx <= PATCH_TILES + 1; tx += 1) {
        if (!pass.materials.includes(isWaterAt(tx, ty))) continue;
        hasWater = true;
        const cx = (tx + MARGIN_TILES + 0.5) * maskPxPerTile;
        const cy = (ty + MARGIN_TILES + 0.5) * maskPxPerTile;
        maskContext.beginPath();
        maskContext.arc(cx, cy, maskPxPerTile * pass.radius, 0, Math.PI * 2);
        maskContext.fill();
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
          if (!pass.materials.includes(isWaterAt(tx + dx, ty + dy))) continue;
          maskContext.beginPath();
          maskContext.moveTo(cx, cy);
          maskContext.lineTo((tx + dx + MARGIN_TILES + 0.5) * maskPxPerTile, (ty + dy + MARGIN_TILES + 0.5) * maskPxPerTile);
          maskContext.stroke();
        }
      }
    }
    maskContext.restore();
    if (!hasWater) continue;
    composite.save();
    composite.globalAlpha = pass.opacity;
    if (pass.kind === "body" && waterImage) {
      // the enriched water painting (foam streaks, eddies) carries the body
      // of the stream; the dark deep pass above it keeps a readable channel
      composite.globalCompositeOperation = "source-over";
      applyMaskedImage(composite, maskCanvas, waterImage, superX, superY);
    } else {
      composite.fillStyle = pass.color;
      applyMaskedFill(composite, maskCanvas);
    }
    composite.restore();
  }
}

let wearScratch = null;

// Ragged trail borders like the mockup: a world-anchored noise threshold
// eats into the smooth stroke mask, so grass bites the trail edge in
// patches and a semi-transparent scuffed fringe forms around the core.
// Noise samples world coordinates, so edges match across patch margins.
function raggedizeWearMask(maskContext, superX, superY) {
  const maskPxPerTile = MASK_SIZE / CANVAS_TILES;
  const imageData = maskContext.getImageData(0, 0, MASK_SIZE, MASK_SIZE);
  const data = imageData.data;
  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      const offset = (y * MASK_SIZE + x) * 4;
      const alpha = data[offset + 3] / 255;
      if (alpha <= 0.01) continue;
      const wtx = superX * PATCH_TILES + x / maskPxPerTile - MARGIN_TILES;
      const wty = superY * PATCH_TILES + y / maskPxPerTile - MARGIN_TILES;
      const noise =
        wearNoise(wtx * 1.6, wty * 1.6, 31) * 0.7 +
        wearNoise(wtx * 4.2, wty * 4.2, 67) * 0.3;
      // wide soft knee: dirt THINS into grass over a broad band, with only
      // a gentle wobble on the falloff distance — subtle, neat transition
      const threshold = 0.33 + (noise - 0.5) * 0.2;
      const shaped = Math.min(1, Math.max(0, (alpha - threshold) / 0.5));
      data[offset + 3] = Math.round(shaped * 255);
    }
  }
  maskContext.putImageData(imageData, 0, 0);
}

function wearNoise(x, y, salt) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = (x - x0) * (x - x0) * (3 - 2 * (x - x0));
  const fy = (y - y0) * (y - y0) * (3 - 2 * (y - y0));
  const nw = stampHash01(x0, y0, salt);
  const ne = stampHash01(x0 + 1, y0, salt);
  const sw = stampHash01(x0, y0 + 1, salt);
  const se = stampHash01(x0 + 1, y0 + 1, salt);
  return (nw * (1 - fx) + ne * fx) * (1 - fy) + (sw * (1 - fx) + se * fx) * fy;
}

function applyMaskedImage(composite, maskCanvas, image, superX, superY) {
  const scratch = wearScratchContext();
  scratch.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  scratch.globalCompositeOperation = "source-over";
  scratch.imageSmoothingEnabled = true;
  for (let ny = -1; ny <= 1; ny += 1) {
    for (let nx = -1; nx <= 1; nx += 1) {
      scratch.save();
      scratch.translate(
        MARGIN_PX + nx * PATCH_SIZE + PATCH_SIZE / 2,
        MARGIN_PX + ny * PATCH_SIZE + PATCH_SIZE / 2,
      );
      scratch.scale((((superX + nx) % 2) + 2) % 2 === 0 ? 1 : -1, (((superY + ny) % 2) + 2) % 2 === 0 ? 1 : -1);
      scratch.drawImage(image, -PATCH_SIZE / 2, -PATCH_SIZE / 2, PATCH_SIZE, PATCH_SIZE);
      scratch.restore();
    }
  }
  scratch.globalCompositeOperation = "destination-in";
  scratch.drawImage(maskCanvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  composite.drawImage(scratch.canvas, 0, 0);
}

function wearScratchContext() {
  if (!wearScratch) {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    wearScratch = canvas.getContext("2d");
  }
  return wearScratch;
}

function applyMaskedFill(composite, maskCanvas) {
  wearScratchContext();
  wearScratch.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  wearScratch.globalCompositeOperation = "source-over";
  wearScratch.fillStyle = composite.fillStyle;
  wearScratch.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  wearScratch.globalCompositeOperation = "destination-in";
  wearScratch.imageSmoothingEnabled = true;
  wearScratch.drawImage(maskCanvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
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
      const mapX = superX * PATCH_TILES + ((x + 0.5) / MASK_SIZE) * CANVAS_TILES - MARGIN_TILES;
      const mapY = superY * PATCH_TILES + ((y + 0.5) / MASK_SIZE) * CANVAS_TILES - MARGIN_TILES;
      const weights = visualBiomeWeightsAt(mapX, mapY, cols, rows, seed);
      const activeTotal = activeBiomes.reduce((sum, activeBiome) => sum + weights[activeBiome], 0) || 1;
      const weight = (weights[biome] ?? 0) / activeTotal;
      // banded transition: posterize the smooth weight into discrete steps
      // with a world-anchored ragged edge, so biomes meet in worn bands
      // like the approved mockup instead of a mushy cross-fade
      const rag =
        wearNoise(mapX * 0.55, mapY * 0.55, 131) * 0.7 +
        wearNoise(mapX * 1.7, mapY * 1.7, 167) * 0.3;
      const banded = Math.round(clamp01(weight + (rag - 0.5) * 0.34) * 3) / 3;
      const offset = (y * MASK_SIZE + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(banded * 255);
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
