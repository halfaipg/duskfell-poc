export function drawEcologyLifecycleCues(ctx, object, point, scale) {
  const lifecycle = object.lifecycle;
  if (!lifecycle) return;

  if (object.kind === "saplingTree") {
    drawTreeBaseResourceCues(ctx, point, scale, lifecycle, object.resources ?? []);
    return;
  }
  if (object.kind === "deadwood") {
    drawDeadwoodDecayCues(ctx, point, scale, lifecycle);
    return;
  }
  if (object.kind === "myceliumPatch") {
    drawMyceliumGrowthCues(ctx, point, scale, lifecycle);
    return;
  }
  if (object.kind === "ruin") {
    drawStoneRuinDecayCues(ctx, point, scale, lifecycle);
  }
}

export function drawDeadwoodDecayCues(ctx, point, scale, lifecycle) {
  const decay = lifecycle.decay ?? 0;
  ctx.save();
  ctx.strokeStyle = `rgba(35, 24, 18, ${0.35 + decay * 0.35})`;
  ctx.lineWidth = Math.max(1, scale * 1.1);
  for (let index = 0; index < 3; index += 1) {
    ctx.beginPath();
    ctx.moveTo(point.x - 15 * scale + index * 10 * scale, point.y - 3 * scale);
    ctx.lineTo(point.x - 9 * scale + index * 8 * scale, point.y + 5 * scale);
    ctx.stroke();
  }
  if (decay > 0.55) {
    ctx.fillStyle = "rgba(176, 150, 203, 0.78)";
    for (let index = 0; index < 4; index += 1) {
      ctx.beginPath();
      ctx.arc(
        point.x - 13 * scale + index * 8 * scale,
        point.y + 9 * scale - (index % 2) * 4 * scale,
        2.2 * scale,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.restore();
}

export function drawMyceliumGrowthCues(ctx, point, scale, lifecycle) {
  const growth = lifecycle.growth ?? 0;
  const health = lifecycle.health ?? growth;
  const hungry = growth < 0.95;
  const tendrils = Math.max(3, Math.round(3 + growth * 5));
  ctx.save();
  ctx.strokeStyle = hungry
    ? `rgba(174, 132, 92, ${0.22 + (1 - growth) * 0.22})`
    : `rgba(196, 175, 218, ${0.3 + health * 0.26})`;
  ctx.lineWidth = Math.max(1, scale * 0.9);
  for (let index = 0; index < tendrils; index += 1) {
    const angle = (Math.PI * 2 * index) / tendrils + 0.35;
    const length = (10 + growth * 14 + (index % 2) * 5) * scale;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y + 3 * scale);
    ctx.quadraticCurveTo(
      point.x + Math.cos(angle + 0.5) * length * 0.45,
      point.y + Math.sin(angle + 0.5) * length * 0.26,
      point.x + Math.cos(angle) * length,
      point.y + Math.sin(angle) * length * 0.42,
    );
    ctx.stroke();
  }
  ctx.fillStyle = hungry ? "rgba(176, 139, 101, 0.62)" : "rgba(218, 201, 232, 0.78)";
  ctx.beginPath();
  ctx.arc(point.x + 11 * scale, point.y + 7 * scale, (2 + health * 2) * scale, 0, Math.PI * 2);
  ctx.fill();
  if (hungry) {
    ctx.strokeStyle = "rgba(96, 65, 43, 0.42)";
    ctx.beginPath();
    ctx.moveTo(point.x - 15 * scale, point.y + 10 * scale);
    ctx.lineTo(point.x - 5 * scale, point.y + 5 * scale);
    ctx.lineTo(point.x + 4 * scale, point.y + 11 * scale);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawStoneRuinDecayCues(ctx, point, scale, lifecycle) {
  const decay = lifecycle.decay ?? 0;
  const age = lifecycle.ageYears ?? 0;
  const moss = Math.min(1, decay * 0.75 + Math.min(age / 120000, 1) * 0.25);
  ctx.save();
  ctx.globalAlpha = 0.16 + decay * 0.22;
  ctx.strokeStyle = "rgba(46, 40, 34, 0.72)";
  ctx.lineWidth = Math.max(1, scale * 0.7);
  ctx.beginPath();
  ctx.moveTo(point.x - 19 * scale, point.y - 21 * scale);
  ctx.lineTo(point.x - 6 * scale, point.y - 11 * scale);
  ctx.lineTo(point.x - 13 * scale, point.y + 2 * scale);
  ctx.moveTo(point.x + 15 * scale, point.y - 17 * scale);
  ctx.lineTo(point.x + 5 * scale, point.y - 6 * scale);
  ctx.lineTo(point.x + 18 * scale, point.y + 4 * scale);
  ctx.stroke();

  if (moss > 0.2) {
    ctx.globalAlpha = 0.2 + moss * 0.38;
    ctx.fillStyle = "rgba(91, 126, 67, 0.82)";
    for (let patch = 0; patch < 4; patch += 1) {
      const offset = patch - 1.5;
      ctx.beginPath();
      ctx.ellipse(
        point.x + offset * 9 * scale,
        point.y + (10 + (patch % 2) * 4) * scale,
        (2.5 + moss * 2) * scale,
        (1.2 + moss) * scale,
        -0.2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawTreeBaseResourceCues(ctx, point, scale, lifecycle, resources = []) {
  const health = lifecycle.health ?? 1;
  const resourceList = Array.isArray(resources) ? resources : [resources].filter(Boolean);
  const wood = resourceList.find((resource) => resource.kind === "wood");
  const seeds = resourceList.find((resource) => resource.kind === "seed");
  const fullness = wood?.maxAmount ? clamp(wood.amount / wood.maxAmount, 0, 1) : lifecycle.growth ?? 0.6;
  const seedCount = Math.min(2, seeds?.amount ?? 0);

  ctx.save();
  ctx.globalAlpha = 0.12 + health * 0.16;
  ctx.strokeStyle = health > 0.55 ? "#d4c36f" : "#9b8062";
  ctx.lineWidth = Math.max(1, scale * 0.75);
  ctx.beginPath();
  ctx.arc(point.x, point.y + 4 * scale, (6 + fullness * 5) * scale, 0.12 * Math.PI, 0.88 * Math.PI);
  ctx.stroke();

  ctx.globalAlpha = 0.38 + health * 0.18;
  ctx.fillStyle = health > 0.48 ? "#8d9454" : "#7d6145";
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + 8 * scale, (2.2 + fullness * 2) * scale, 1.4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.68;
  ctx.fillStyle = "#c5b45c";
  for (let index = 0; index < seedCount; index += 1) {
    ctx.beginPath();
    ctx.ellipse(
      point.x + 7 * scale + index * 4 * scale,
      point.y + 8 * scale,
      1.4 * scale,
      1.9 * scale,
      0.3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
