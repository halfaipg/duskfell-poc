import {
  drawDeadwoodDecayCues,
  drawMyceliumGrowthCues,
  drawStoneRuinDecayCues,
} from "./ecology-lifecycle-cue-draw.js";
import { terrainResourceCues } from "./terrain-resource-cues.js";

export function drawTerrainDetailLifecycleCues(ctx, detail, point, scale) {
  if (detail.kind === "tree") {
    drawTerrainDetailTreeCues(ctx, detail, point, scale);
  } else if (detail.kind === "fallen-log" || detail.kind === "stump") {
    drawDeadwoodDecayCues(ctx, point, Math.max(0.48, scale * 0.76), detail.lifecycle ?? {});
  } else if (detail.kind === "mushroom") {
    drawMyceliumGrowthCues(ctx, point, Math.max(0.42, scale * 0.7), detail.lifecycle ?? {});
  } else if (["ruin", "wall", "stairs", "foundation"].includes(detail.kind)) {
    drawStoneRuinDecayCues(ctx, point, Math.max(0.36, scale * 0.5), detail.lifecycle ?? {});
  }
  drawTerrainResourceCues(ctx, detail, point, scale);
}

function drawTerrainDetailTreeCues(ctx, detail, point, scale) {
  const lifecycle = detail.lifecycle ?? {};
  const wood = detail.resources?.find((resource) => resource.kind === "wood");
  const hasSeed = detail.resources?.some((resource) => resource.kind === "seed" && resource.amount > 0);
  const fullness = wood?.maxAmount ? clamp(wood.amount / wood.maxAmount, 0, 1) : 0.45;
  const health = clamp(lifecycle.health ?? detail.health ?? 1, 0, 1);
  const decay = clamp(lifecycle.decay ?? 0, 0, 1);
  const cueScale = Math.max(0.48, scale * 0.46);

  ctx.save();
  ctx.globalAlpha = 0.1 + health * 0.15;
  ctx.strokeStyle = decay > 0.45 ? "#9f7b55" : "#c8bb67";
  ctx.lineWidth = Math.max(1, cueScale * 0.85);
  ctx.beginPath();
  ctx.arc(point.x, point.y + 7 * cueScale, (7 + fullness * 4) * cueScale, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.stroke();

  ctx.globalAlpha = 0.4 + health * 0.18;
  ctx.fillStyle = hasSeed ? "#e0c75d" : health > 0.52 ? "#b9c56f" : "#9a7a55";
  ctx.beginPath();
  ctx.ellipse(
    point.x - 5 * cueScale,
    point.y + 9 * cueScale,
    (1.5 + fullness * 1.8) * cueScale,
    1.2 * cueScale,
    0.2,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  if (hasSeed) {
    ctx.beginPath();
    ctx.ellipse(point.x + 5 * cueScale, point.y + 9 * cueScale, 1.3 * cueScale, 1.8 * cueScale, 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  if (decay > 0.32) {
    ctx.globalAlpha = 0.14 + decay * 0.22;
    ctx.strokeStyle = "#6f5139";
    ctx.beginPath();
    ctx.moveTo(point.x - 9 * cueScale, point.y + 2 * cueScale);
    ctx.lineTo(point.x - 2 * cueScale, point.y + 7 * cueScale);
    ctx.lineTo(point.x + 7 * cueScale, point.y + 1 * cueScale);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTerrainResourceCues(ctx, detail, point, scale) {
  const cues = terrainResourceCues(detail);
  if (cues.length === 0) return;
  const cueScale = Math.max(0.38, scale * 0.36);

  ctx.save();
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    const offset = (index - (cues.length - 1) / 2) * 7.5 * cueScale;
    if (cue.kind === "organic-ring") {
      ctx.globalAlpha = 0.09 + cue.intensity * 0.24;
      ctx.strokeStyle = terrainCueColor(cue.tone, "stroke");
      ctx.lineWidth = Math.max(1, cueScale * 0.72);
      ctx.beginPath();
      ctx.ellipse(point.x + offset, point.y + 10 * cueScale, cue.radius * cueScale, cue.radius * 0.44 * cueScale, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (cue.kind === "seed" || cue.kind === "spore") {
      ctx.globalAlpha = cue.kind === "seed" ? 0.52 + cue.health * 0.18 : 0.44 + cue.decay * 0.22;
      ctx.fillStyle = terrainCueColor(cue.tone, "fill");
      for (let pip = 0; pip < cue.count; pip += 1) {
        ctx.beginPath();
        ctx.ellipse(
          point.x + offset + (pip - (cue.count - 1) / 2) * 3.4 * cueScale,
          point.y + (11 - (pip % 2) * 2) * cueScale,
          1.45 * cueScale,
          (cue.kind === "seed" ? 2.1 : 1.55) * cueScale,
          0.25,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    } else if (cue.kind === "fiber") {
      ctx.globalAlpha = 0.22 + cue.intensity * 0.28;
      ctx.strokeStyle = terrainCueColor(cue.tone, "stroke");
      ctx.lineWidth = Math.max(1, cueScale * 0.55);
      for (let blade = 0; blade < cue.count; blade += 1) {
        const bladeOffset = (blade - cue.count / 2) * 2.5 * cueScale;
        ctx.beginPath();
        ctx.moveTo(point.x + offset + bladeOffset, point.y + 11 * cueScale);
        ctx.quadraticCurveTo(
          point.x + offset + bladeOffset * 0.85,
          point.y + 5 * cueScale,
          point.x + offset + bladeOffset * 0.55,
          point.y + 1 * cueScale,
        );
        ctx.stroke();
      }
    } else if (cue.kind === "rot-feed") {
      ctx.globalAlpha = 0.18 + cue.decay * 0.3;
      ctx.strokeStyle = terrainCueColor(cue.tone, "stroke");
      ctx.lineWidth = Math.max(1, cueScale * 0.82);
      for (let crack = 0; crack < cue.cracks; crack += 1) {
        const crackOffset = (crack - cue.cracks / 2) * 4.1 * cueScale;
        ctx.beginPath();
        ctx.moveTo(point.x + offset + crackOffset, point.y + 6 * cueScale);
        ctx.lineTo(point.x + offset + crackOffset + 2.4 * cueScale, point.y + 12 * cueScale);
        ctx.stroke();
      }
    } else if (cue.kind === "mycelium") {
      ctx.globalAlpha = 0.2 + cue.intensity * 0.32;
      ctx.strokeStyle = terrainCueColor(cue.tone, "stroke");
      ctx.lineWidth = Math.max(1, cueScale * 0.72);
      for (let tendril = 0; tendril < cue.tendrils; tendril += 1) {
        const angle = (Math.PI * 2 * tendril) / cue.tendrils;
        const length = (5 + cue.fullness * 8) * cueScale;
        ctx.beginPath();
        ctx.moveTo(point.x + offset, point.y + 8 * cueScale);
        ctx.lineTo(point.x + offset + Math.cos(angle) * length, point.y + 8 * cueScale + Math.sin(angle) * length * 0.34);
        ctx.stroke();
      }
    } else if (cue.kind === "charge") {
      ctx.globalAlpha = 0.26 + cue.fullness * 0.38;
      ctx.strokeStyle = terrainCueColor(cue.tone, "stroke");
      ctx.lineWidth = Math.max(1, cueScale * 0.8);
      for (let arc = 0; arc < cue.arcs; arc += 1) {
        const arcOffset = (arc - cue.arcs / 2) * 4 * cueScale;
        ctx.beginPath();
        ctx.moveTo(point.x + offset + arcOffset, point.y + 12 * cueScale);
        ctx.lineTo(point.x + offset + arcOffset + 3 * cueScale, point.y + 7 * cueScale);
        ctx.lineTo(point.x + offset + arcOffset - 1 * cueScale, point.y + 8 * cueScale);
        ctx.stroke();
      }
    } else if (cue.kind === "mineral") {
      ctx.globalAlpha = 0.2 + cue.intensity * 0.28;
      ctx.fillStyle = terrainCueColor(cue.tone, "fill");
      for (let chip = 0; chip < cue.chips; chip += 1) {
        const chipOffset = (chip - cue.chips / 2) * 3.8 * cueScale;
        ctx.beginPath();
        ctx.rect(point.x + offset + chipOffset, point.y + 8 * cueScale + (chip % 2) * 2 * cueScale, 2.3 * cueScale, 1.8 * cueScale);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function terrainCueColor(tone, channel) {
  const colors = {
    green: { fill: "#b9c56f", stroke: "#c8bb67" },
    deep: { fill: "#6f8f5d", stroke: "#8ca66a" },
    iron: { fill: "#a7a590", stroke: "#c0b98e" },
    pale: { fill: "#c5bf92", stroke: "#ded39a" },
    gold: { fill: "#e0c75d", stroke: "#cdb658" },
    reed: { fill: "#8ea35f", stroke: "#aeb773" },
    bark: { fill: "#835d3d", stroke: "#6f5139" },
    spore: { fill: "#b69acb", stroke: "#8d739e" },
    violet: { fill: "#c6a3dc", stroke: "#a084bd" },
    hungry: { fill: "#b08462", stroke: "#a56f4c" },
    bloom: { fill: "#d9c4ec", stroke: "#bda4d3" },
    spent: { fill: "#718489", stroke: "#69888c" },
    arc: { fill: "#8ee7ee", stroke: "#8ee7ee" },
    stone: { fill: "#aaa38f", stroke: "#8c887b" },
    ore: { fill: "#9fb2b1", stroke: "#7f9b9d" },
  }[tone] ?? { fill: "#b9c56f", stroke: "#c8bb67" };
  return colors[channel] ?? colors.fill;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
