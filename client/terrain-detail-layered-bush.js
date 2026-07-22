import { shadowCast, windStrength } from "./sun-state.js";

export function drawLayeredBush(ctx, detail, point) {
  if (detail.renderStyle !== "layered-bush") return false;
  const scale = detail.scale ?? 1;
  const stage = detail.stage ?? "mature";
  const dead = stage === "dead";
  const dying = stage === "dying";
  const heath = stage === "heath";
  const young = stage === "young";
  const cast = shadowCast();
  const width = (stage === "mature" ? 44 : young ? 22 : 34) * scale;
  const height = (stage === "mature" ? 42 : young ? 23 : 31) * scale;

  ctx.save();
  ctx.fillStyle = `rgba(13, 16, 11, ${Math.max(0.1, cast.alpha * 0.62)})`;
  ctx.beginPath();
  ctx.ellipse(
    point.x + cast.dirX * height * cast.length * 0.32,
    point.y + 3 + cast.dirY * height * cast.length * 0.18,
    width * (0.42 + cast.length * 0.1),
    height * 0.18,
    0.16,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  const seconds = performance.now() / 1000;
  const sway = Math.sin(seconds * 1.35 + detail.variant * 1.71) * windStrength() * (dead ? 0.8 : 1.7);
  ctx.translate(point.x, point.y);
  ctx.transform(1, 0, sway * 0.006, 1, 0, 0);
  drawBranches(ctx, detail, width, height, dead || dying);
  if (!dead) drawFoliage(ctx, detail, width, height, { dying, heath, young });
  ctx.restore();
  return true;
}

function drawBranches(ctx, detail, width, height, sparse) {
  const count = sparse ? 14 : 18;
  ctx.lineCap = "round";
  for (let branch = 0; branch < count; branch += 1) {
    const roll = pseudo(detail.variant, branch, 1);
    const side = branch % 2 === 0 ? -1 : 1;
    const baseX = (roll - 0.5) * width * 0.16;
    const tipX = side * width * (0.18 + pseudo(detail.variant, branch, 3) * 0.34);
    const tipY = -height * (0.3 + pseudo(detail.variant, branch, 5) * 0.7);
    ctx.strokeStyle = branch % 3 === 0 ? "rgba(48, 39, 27, 0.96)" : "rgba(67, 50, 30, 0.92)";
    ctx.lineWidth = Math.max(0.8, (1.45 - branch * 0.025) * Math.sqrt(detail.scale ?? 1));
    ctx.beginPath();
    ctx.moveTo(baseX, 1);
    ctx.quadraticCurveTo(tipX * 0.35, tipY * 0.44, tipX, tipY);
    ctx.stroke();
    if (sparse || branch % 3 === 0) {
      ctx.beginPath();
      ctx.moveTo(tipX * 0.58, tipY * 0.58);
      ctx.lineTo(tipX + side * width * (0.09 + roll * 0.08), tipY + height * (0.05 + roll * 0.08));
      ctx.stroke();
    }
  }
}

function drawFoliage(ctx, detail, width, height, { dying, heath, young }) {
  const count = young ? 52 : 112;
  const base = heath
    ? [68, 74, 38]
    : dying
      ? [91, 82, 39]
      : [50, 76, 34];
  // Dark, overlapping interior masses keep the plant readable at game
  // scale; the small leaf pass below breaks their edges without turning
  // the silhouette into a collection of flat paddles.
  for (let mass = 0; mass < (young ? 5 : 9); mass += 1) {
    const x = (pseudo(detail.variant, mass, 29) - 0.5) * width * 0.56;
    const y = -height * (0.28 + pseudo(detail.variant, mass, 31) * 0.54);
    ctx.fillStyle = heath ? "rgba(38, 48, 28, 0.82)" : "rgba(28, 45, 23, 0.86)";
    ctx.beginPath();
    ctx.ellipse(x, y, width * 0.19, height * 0.13, (mass - 4) * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let leaf = 0; leaf < count; leaf += 1) {
    const angle = pseudo(detail.variant, leaf, 11) * Math.PI * 2;
    const radius = Math.sqrt(pseudo(detail.variant, leaf, 13));
    const x = Math.cos(angle) * width * 0.42 * radius;
    const y = -height * (0.22 + pseudo(detail.variant, leaf, 17) * 0.72) + Math.sin(angle) * height * 0.08;
    const light = pseudo(detail.variant, leaf, 19) * 34 - 13;
    const alpha = 0.72 + pseudo(detail.variant, leaf, 23) * 0.24;
    ctx.fillStyle = `rgba(${base[0] + light}, ${base[1] + light}, ${base[2] + light * 0.35}, ${alpha})`;
    ctx.beginPath();
    const leafScale = 0.7 + pseudo(detail.variant, leaf, 27) * 0.55;
    ctx.ellipse(x, y, width * 0.032 * leafScale, height * 0.021 * leafScale, angle * 0.4, 0, Math.PI * 2);
    ctx.fill();
    if (heath && leaf % 4 === 0) {
      ctx.fillStyle = "rgba(125, 93, 126, 0.82)";
      ctx.beginPath();
      ctx.arc(x + 1, y - 1, Math.max(0.8, width * 0.012), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function pseudo(a, b, c) {
  const value = Math.sin((a + 1) * 12.9898 + (b + 1) * 78.233 + c * 37.719) * 43758.5453;
  return value - Math.floor(value);
}
