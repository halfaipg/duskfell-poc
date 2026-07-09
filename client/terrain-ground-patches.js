import { projectMap } from "./projection.js";

// Continuous painterly ground: world-anchored 1024px plan patches (16 tiles at
// 64px/tile) drawn under the tile pass, so ground materials read as one
// painting instead of a repeating 64px pattern. Each 8x8-tile chunk samples
// its quadrant of the patch; a 16-tile "supertile" hash picks the variant,
// keeping the painting continuous across the four chunks it spans. Materials
// with a patch entry skip their per-tile atlas fill (flat, ground-level tiles
// only — slopes and elevated tiles keep atlas art).
// Worldgen speckles small material blobs everywhere; every blob border chops
// the painting. For the locked look, all open land renders as ONE meadow
// painting (which carries its own dirt/grass variation) — only deliberate
// features stay distinct: roads/plaza (settlement), shoreline sand, water.
const MATERIAL_ALIAS = {
  field: "grass",
  dirt: "grass",
  rock: "grass",
  ruin: "grass",
  stone: "grass",
};
// settlement/cobble (roads, plazas) deliberately stay on ATLAS tiles: a
// 1-tile road sampling the big painting renders as a featureless ribbon —
// roads need per-tile texture. Water stays atlas for shimmer decals.
const PATCH_URLS = {
  grass: ["/assets/terrain/ground-patches/meadow-a.png"],
  shore: ["/assets/terrain/ground-patches/shore-a.png"],
};
const PATCH_TILES = 16;
const PLAN_PX_PER_TILE = 64;

let materialImages = null;
let pendingCount = 0;
let version = 0;

function ensureLoaded() {
  if (materialImages) return;
  materialImages = new Map();
  for (const [material, urls] of Object.entries(PATCH_URLS)) {
    const entry = { images: [], ready: 0 };
    for (const url of urls) {
      const img = new Image();
      pendingCount += 1;
      img.onload = () => {
        entry.ready += 1;
        version += 1;
      };
      img.onerror = () => {};
      img.src = url;
      entry.images.push(img);
    }
    materialImages.set(material, entry);
  }
}

function materialPatchEntry(material) {
  ensureLoaded();
  const resolved = MATERIAL_ALIAS[material] ?? material;
  const entry = materialImages.get(resolved);
  if (!entry || entry.ready !== entry.images.length || entry.images.length === 0) return null;
  return entry;
}

export function groundPatchVersion() {
  ensureLoaded();
  return version;
}

export function tileUsesGroundPatch(tile) {
  return materialPatchEntry(tile.material) !== null;
}

export function materialHasGroundPatch(material) {
  return materialPatchEntry(material) !== null;
}

export function drawChunkGroundPatch(ctx, chunk, origin) {
  if (!origin) return false;
  // group this chunk's patched tiles by material; the painting is draped in
  // screen space (z=0 plane), so texture stays continuous across elevation —
  // facet/height shading and side walls carry the depth read
  const groups = new Map();
  for (const tileView of chunk.tiles) {
    if (!tileUsesGroundPatch(tileView.tile)) continue;
    const material = MATERIAL_ALIAS[tileView.tile.material] ?? tileView.tile.material;
    if (!groups.has(material)) groups.set(material, []);
    groups.get(material).push(tileView);
  }
  if (groups.size === 0) return false;

  const superX = Math.floor(chunk.x / PATCH_TILES);
  const superY = Math.floor(chunk.y / PATCH_TILES);
  const anchor = projectMap(superX * PATCH_TILES, superY * PATCH_TILES, 0, origin);

  for (const [material, tileViews] of groups) {
    const entry = materialPatchEntry(material);
    if (!entry) continue;
    const img = entry.images[Math.abs(superX * 7 + superY * 13) % entry.images.length];
    ctx.save();
    ctx.beginPath();
    for (const { corners } of tileViews) {
      ctx.moveTo(corners.nw.x, corners.nw.y);
      ctx.lineTo(corners.ne.x, corners.ne.y);
      ctx.lineTo(corners.se.x, corners.se.y);
      ctx.lineTo(corners.sw.x, corners.sw.y);
      ctx.closePath();
    }
    ctx.clip();
    // plan(u,v) -> screen: x = ax + (u - v) / 2, y = ay + (u + v) / 2
    // (45-degree rotation + 1/sqrt(2) scale = military plan-oblique tile grid)
    // full-image draw anchored at the supertile origin, expanded 1 plan px to
    // overlap neighbours (kills bilinear edge-bleed seam lines); alternating
    // supertiles mirror the painting so borders match exactly (no variant clash)
    ctx.transform(0.5, 0.5, -0.5, 0.5, anchor.x, anchor.y);
    const span = PATCH_TILES * PLAN_PX_PER_TILE;
    const flipX = ((superX % 2) + 2) % 2 === 1;
    const flipY = ((superY % 2) + 2) % 2 === 1;
    ctx.translate(span / 2, span / 2);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.translate(-span / 2, -span / 2);
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, -1, -1, span + 2, span + 2);
    ctx.restore();
  }
  return true;
}
