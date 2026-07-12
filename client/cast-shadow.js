import { shadowCast } from "./sun-state.js";

// Sun-cast sprite shadows: the sprite frame's own silhouette, flipped so its
// feet sit at the anchor, sheared along the sun's screen direction and
// squashed onto the ground plane. Replaces the floating blob ellipses.
const silhouetteCache = new Map();
const MAX_SILHOUETTES = 256;

function silhouetteFor(image, sx, sy, sw, sh, cacheKey) {
  const cached = silhouetteCache.get(cacheKey);
  if (cached) return cached;
  if (silhouetteCache.size >= MAX_SILHOUETTES) silhouetteCache.clear();
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // flip vertically so row 0 = feet, then fill black through the alpha
  ctx.translate(0, sh);
  ctx.scale(1, -1);
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#10140f";
  ctx.fillRect(0, 0, sw, sh);
  silhouetteCache.set(cacheKey, canvas);
  return canvas;
}

// contact ellipse stays as soft ambient occlusion so nothing floats even at
// noon or night; the directional silhouette is the sun shadow on top
export function drawCastShadow(ctx, image, sx, sy, sw, sh, foot, scale, cacheKey, anchorX) {
  const cast = shadowCast();
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#10140f";
  ctx.beginPath();
  ctx.ellipse(foot.x, foot.y, sw * scale * 0.22, sw * scale * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (cast.alpha <= 0.01 || cast.length <= 0.01) return;

  const silhouette = silhouetteFor(image, sx, sy, sw, sh, cacheKey);
  if (!silhouette) return;
  ctx.save();
  ctx.globalAlpha = cast.alpha;
  // sprite-space (px, py-up-from-feet) maps to foot + shear along the cast
  ctx.transform(
    scale,
    0,
    cast.dirX * cast.length * scale,
    cast.dirY * cast.length * scale * 0.55,
    foot.x,
    foot.y,
  );
  ctx.drawImage(silhouette, -anchorX, 0);
  ctx.restore();
}
