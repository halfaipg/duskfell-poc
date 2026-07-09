import { transitionMaskKey, transitionPairKey, transitionPairMaskKey } from "./terrain-assets.js";
import { clamp, cornerBandPoints, edgeBandPoints, edgePoints, stableStringHash } from "./terrain-draw-geometry.js";
import { materialHasGroundPatch } from "./terrain-ground-patches.js";

export function createTerrainTransitionDrawer({ getContext, getTerrainAssets, drawAtlasFrame }) {
  function drawTerrainTransitions(tile, corners) {
    const ctx = getContext();
    for (const transition of tile.transitions) {
      // painted ground blends in the painting itself — band/stroke/cue
      // overlays just scratch lines onto it (water edges included: the dark
      // water body against the painting is the shoreline)
      if (materialHasGroundPatch(transition.from) || materialHasGroundPatch(transition.to)) continue;
      const drewAtlasTransition = drawTerrainTransitionAtlas(transition, corners);
      drawTransitionMaterialCues(transition, corners, drewAtlasTransition);
      const edgeStyle = transitionEdgeStyle(transition, drewAtlasTransition);
      if (edgeStyle.width <= 0 || edgeStyle.alpha <= 0) continue;
      const edge = transition.mask?.edge ?? transition.edge;
      const [from, to] = edgePoints(corners, edge);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = transitionStrokeColor(transition);
      ctx.lineWidth = edgeStyle.width;
      ctx.globalAlpha = edgeStyle.alpha;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawTerrainTransitionAtlas(transition, corners) {
    const terrainAssets = getTerrainAssets();
    const atlasTile = transitionAtlasTileFor(transition, terrainAssets.atlas);
    const image = terrainAssets.image;
    if (!atlasTile || !image?.complete || image.naturalWidth === 0) return false;

    const ctx = getContext();
    const band = transitionMaskPoints(transition, corners);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(band[0].x, band[0].y);
    for (const point of band.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    ctx.clip();
    drawAtlasFrame(atlasTile.frame, corners, transitionAtlasAlpha(transition));
    ctx.restore();
    return true;
  }

  function drawTransitionMaterialCues(transition, corners, drewAtlasTransition) {
    if (transition.mask?.type === "corner") return;
    const family = transition.family ?? "soft";
    if (family === "soft") return;

    const ctx = getContext();
    const edge = transition.mask?.edge ?? transition.edge;
    const [from, to] = edgePoints(corners, edge);
    const seed = transition.seed ?? stableStringHash(`${transition.pair}:${edge}`);
    const cueCount = { path: 3, plaza: 4, rocky: 4, shore: 5 }[family] ?? 0;
    if (cueCount <= 0) return;

    ctx.save();
    ctx.globalAlpha = drewAtlasTransition ? 0.34 : 0.42;
    for (let index = 0; index < cueCount; index += 1) {
      const t = (index + 1) / (cueCount + 1);
      const jitter = transitionHash01(seed, index) * 0.2 - 0.1;
      const x = from.x + (to.x - from.x) * clamp(t + jitter, 0.08, 0.92);
      const y = from.y + (to.y - from.y) * clamp(t - jitter * 0.5, 0.08, 0.92);
      drawTransitionCueChip(family, x, y, seed + index * 97);
    }
    ctx.restore();
  }

  function drawTransitionCueChip(family, x, y, seed) {
    const ctx = getContext();
    const size = 1.8 + transitionHash01(seed, 13) * 2.2;
    if (family === "shore") {
      ctx.strokeStyle = "rgba(224, 216, 159, 0.82)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - size * 1.8, y + size * 0.4);
      ctx.lineTo(x + size * 1.6, y - size * 0.6);
      ctx.stroke();
      return;
    }
    if (family === "plaza") {
      ctx.fillStyle = "rgba(226, 211, 160, 0.74)";
      ctx.strokeStyle = "rgba(76, 70, 57, 0.64)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size * 1.6, y);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x - size * 1.6, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
    }
    if (family === "rocky") {
      ctx.fillStyle = "rgba(45, 50, 48, 0.74)";
      ctx.fillRect(Math.round(x - size), Math.round(y - size * 0.5), Math.max(1, Math.round(size * 2)), Math.max(1, Math.round(size)));
      return;
    }
    ctx.fillStyle = "rgba(95, 64, 40, 0.62)";
    ctx.beginPath();
    ctx.ellipse(x, y, size, size * 0.48, -0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  return {
    drawTerrainTransitions,
  };
}

function transitionEdgeStyle(transition, drewAtlasTransition) {
  if (transition.mask?.type === "corner") {
    return {
      width: 0,
      alpha: 0,
    };
  }
  const family = transition.family ?? "soft";
  const styles = {
    path: { width: drewAtlasTransition ? 0.55 : 1.25, alpha: drewAtlasTransition ? 0.08 : 0.18 },
    plaza: { width: drewAtlasTransition ? 0.85 : 1.65, alpha: drewAtlasTransition ? 0.13 : 0.24 },
    rocky: { width: drewAtlasTransition ? 0.7 : 1.45, alpha: drewAtlasTransition ? 0.11 : 0.22 },
    shore: { width: drewAtlasTransition ? 0.8 : 1.9, alpha: drewAtlasTransition ? 0.14 : 0.28 },
    soft: { width: drewAtlasTransition ? 0 : 0.65, alpha: drewAtlasTransition ? 0 : 0.1 },
  };
  return styles[family] ?? styles.soft;
}

function transitionAtlasAlpha(transition) {
  const family = transition.family ?? "soft";
  if (family === "shore") return 0.76;
  if (family === "plaza") return 0.68;
  if (family === "rocky") return 0.66;
  if (family === "path") return 0.62;
  return 0.54;
}

function transitionStrokeColor(transition) {
  const colors = {
    path: "rgba(82, 55, 36, 0.9)",
    plaza: "rgba(86, 80, 64, 0.9)",
    rocky: "rgba(48, 55, 52, 0.92)",
    shore: "rgba(191, 178, 120, 0.92)",
    soft: transition.color,
  };
  return colors[transition.family] ?? transition.color;
}

function transitionHash01(seed, salt) {
  let value = Math.imul((seed + salt + 101) | 0, 1664525) + 1013904223;
  value = (value ^ (value >>> 16)) >>> 0;
  return value / 0xffffffff;
}

function transitionAtlasTileFor(transition, atlas) {
  if (!atlas) return null;
  const mask = transition.mask;
  if (transition.from && transition.to) {
    if (mask) {
      const maskedPair = atlas.pairTransitionByPairAndMask?.get(transitionPairMaskKey(transition.from, transition.to, mask));
      if (maskedPair) return maskedPair;
    }
    const pair = atlas.pairTransitionByPair?.get(transitionPairKey(transition.from, transition.to));
    if (pair) return pair;
  }
  if (mask) {
    const masked = atlas.transitionByMaterialAndMask?.get(transitionMaskKey(transition.to, mask));
    if (masked) return masked;
  }
  return atlas.transitionByMaterial?.get(transition.to) ?? null;
}

function transitionMaskPoints(transition, corners) {
  const mask = transition.mask;
  if (mask?.type === "corner") {
    return cornerBandPoints(corners, mask.corner, mask.depth ?? 0.32);
  }
  return edgeBandPoints(corners, mask?.edge ?? transition.edge, mask?.depth ?? 0.34);
}
