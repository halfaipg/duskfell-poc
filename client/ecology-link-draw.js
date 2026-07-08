import { ecologyObjectGroundPoint, quadraticPoint, stableStringHash } from "./ecology-renderer-utils.js";

export function drawEcologyEnergyLink(ctx, link, origin, now, terrain) {
  const source = ecologyObjectGroundPoint(link.source, origin, terrain);
  const target = ecologyObjectGroundPoint(link.target, origin, terrain);
  const hash = stableStringHash(`${link.source.id}:${link.target.id}:charge`);
  const pulse = Math.sin(now * 0.009 + hash * 0.013) * 0.5 + 0.5;
  const mid = {
    x: (source.x + target.x) / 2 + Math.sin(hash) * 8,
    y: (source.y + target.y) / 2 - 7 - pulse * 5,
  };
  const alpha = link.spent ? 0.1 + link.strength * 0.14 : 0.18 + link.strength * 0.42;

  ctx.globalAlpha = alpha;
  ctx.strokeStyle = link.spent ? "rgba(74, 91, 93, 0.72)" : "rgba(95, 207, 223, 0.76)";
  ctx.lineWidth = link.spent ? 2.4 : 3.2 + pulse * 1.4;
  ctx.setLineDash(link.spent ? [9, 7] : [4, 6]);
  ctx.lineDashOffset = -now * (link.spent ? 0.006 : 0.025);
  ctx.beginPath();
  ctx.moveTo(source.x, source.y + 1);
  ctx.quadraticCurveTo(mid.x, mid.y, target.x, target.y + 3);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!link.spent) {
    ctx.globalAlpha = 0.18 + link.strength * 0.46;
    ctx.strokeStyle = "rgba(230, 251, 232, 0.86)";
    ctx.lineWidth = 1.1 + pulse * 0.9;
    ctx.beginPath();
    ctx.moveTo(source.x + 3, source.y - 2);
    ctx.lineTo(mid.x - 6 + pulse * 5, mid.y + 4);
    ctx.lineTo(mid.x + 8 - pulse * 4, mid.y - 2);
    ctx.lineTo(target.x - 2, target.y + 2);
    ctx.stroke();
  }

  const beadCount = link.spent ? 2 : 3 + Math.round(link.chargeFullness * 4);
  ctx.fillStyle = link.spent ? "rgba(113, 132, 137, 0.65)" : "rgba(215, 247, 232, 0.92)";
  ctx.globalAlpha = link.spent ? 0.22 : 0.38 + link.strength * 0.5;
  for (let bead = 0; bead < beadCount; bead += 1) {
    const t = (bead + 0.42 + pulse * 0.22) / beadCount;
    const point = quadraticPoint(source, mid, target, t);
    const radius = link.spent ? 1.3 : 1.8 + pulse * 0.7;
    ctx.beginPath();
    ctx.arc(point.x, point.y + 2, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawEcologyFeedLink(ctx, link, origin, now, terrain) {
  const source = ecologyObjectGroundPoint(link.source, origin, terrain);
  const target = ecologyObjectGroundPoint(link.target, origin, terrain);
  const pulse =
    Math.sin(now * 0.0038 + stableStringHash(`${link.source.id}:${link.target.id}`) * 0.017) *
      0.5 +
    0.5;
  const alpha = 0.08 + link.strength * 0.28 + link.hunger * 0.08;
  const mid = {
    x: (source.x + target.x) / 2,
    y: (source.y + target.y) / 2 + 8 + Math.sin(now * 0.0017 + link.distance) * 3,
  };

  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "rgba(69, 45, 39, 0.72)";
  ctx.lineWidth = 5 + link.strength * 3;
  ctx.beginPath();
  ctx.moveTo(source.x, source.y + 7);
  ctx.quadraticCurveTo(mid.x, mid.y + 5, target.x, target.y + 8);
  ctx.stroke();

  ctx.globalAlpha = 0.18 + link.strength * 0.46;
  ctx.strokeStyle = link.hunger > 0.05 ? "rgba(181, 135, 99, 0.82)" : "rgba(190, 166, 211, 0.68)";
  ctx.lineWidth = 1.25 + link.strength * 1.8;
  for (let strand = 0; strand < 3; strand += 1) {
    const offset = (strand - 1) * (4 + link.strength * 5);
    ctx.setLineDash(strand === 1 ? [7, 5] : [3, 6]);
    ctx.lineDashOffset = -now * (0.012 + strand * 0.004) - link.distance * 0.2;
    ctx.beginPath();
    ctx.moveTo(source.x - offset * 0.5, source.y + 4 + offset * 0.32);
    ctx.quadraticCurveTo(
      mid.x + offset,
      mid.y - offset * 0.2,
      target.x + offset * 0.45,
      target.y + 6 - offset * 0.26,
    );
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const beadCount = 2 + Math.round(link.strength * 4);
  ctx.globalAlpha = 0.28 + link.strength * 0.5;
  ctx.fillStyle = link.hunger > 0.05 ? "rgba(205, 166, 119, 0.9)" : "rgba(218, 199, 231, 0.82)";
  for (let bead = 0; bead < beadCount; bead += 1) {
    const t = (bead + 0.5 + pulse * 0.18) / beadCount;
    const point = quadraticPoint(source, mid, target, t);
    const radius = 1.4 + ((bead + Math.round(pulse * 3)) % 3) * 0.45 + link.strength * 0.7;
    ctx.beginPath();
    ctx.arc(point.x, point.y + 7, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
