import { ecologyObjectGroundPoint, stableStringHash } from "./ecology-renderer-utils.js";

export function drawEcologyGroundEffect(ctx, effect, origin, now, terrain) {
  const point = ecologyObjectGroundPoint(effect, origin, terrain);
  const pulse = Math.sin(now * 0.0026 + stableStringHash(effect.id) * 0.017) * 0.5 + 0.5;
  const radius = effect.radius * (0.9 + pulse * 0.08);

  ctx.save();
  ctx.translate(point.x, point.y + 7);
  ctx.scale(1.15, 0.46);

  if (effect.kind === "rot") {
    drawRotGroundEffect(ctx, radius, effect.intensity, pulse);
  } else if (effect.kind === "mycelium") {
    drawMyceliumGroundEffect(ctx, radius, effect.intensity, pulse, effect);
  } else if (effect.kind === "charge") {
    drawChargeGroundEffect(ctx, radius, effect.intensity, pulse, effect.spent);
  } else if (effect.kind === "mineral-decay") {
    drawMineralDecayGroundEffect(ctx, radius, effect.intensity, pulse);
  } else if (effect.kind === "tree-litter") {
    drawTreeLitterGroundEffect(ctx, radius, effect.intensity, pulse, effect);
  } else if (effect.kind === "mineral-dust") {
    drawMineralDustGroundEffect(ctx, radius, effect.intensity, pulse, effect);
  }

  ctx.restore();
}

function drawTreeLitterGroundEffect(ctx, radius, intensity, pulse, effect) {
  const sickly = 1 - (effect.health ?? 1);
  const old = effect.agePressure ?? 0;
  ctx.globalAlpha = 0.08 + intensity * 0.16;
  ctx.fillStyle = sickly > 0.35 || old > 0.6 ? "rgba(108, 84, 49, 0.86)" : "rgba(59, 95, 47, 0.84)";
  ctx.beginPath();
  ctx.ellipse(0, 0, radius, radius * 0.68, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.1 + intensity * 0.18;
  ctx.strokeStyle = sickly > 0.35 ? "rgba(80, 51, 31, 0.78)" : "rgba(43, 61, 34, 0.78)";
  ctx.lineWidth = 1.5;
  const roots = 5;
  for (let index = 0; index < roots; index += 1) {
    const angle = (Math.PI * 2 * index) / roots + pulse * 0.18;
    const length = radius * (0.28 + old * 0.18 + (index % 2) * 0.12);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(
      Math.cos(angle + 0.55) * length * 0.52,
      Math.sin(angle + 0.55) * length * 0.22,
      Math.cos(angle) * length,
      Math.sin(angle) * length * 0.46,
    );
    ctx.stroke();
  }

  ctx.globalAlpha = 0.14 + intensity * 0.16;
  ctx.fillStyle = sickly > 0.35 || old > 0.6 ? "rgba(171, 135, 75, 0.78)" : "rgba(151, 172, 87, 0.76)";
  for (let chip = 0; chip < 7; chip += 1) {
    const angle = chip * 1.9 + pulse * 0.2;
    const distance = radius * (0.18 + (chip % 4) * 0.13);
    ctx.beginPath();
    ctx.ellipse(
      Math.cos(angle) * distance,
      Math.sin(angle) * distance * 0.44,
      1.8 + (chip % 2),
      0.9 + old * 0.7,
      angle * 0.2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function drawRotGroundEffect(ctx, radius, intensity, pulse) {
  ctx.globalAlpha = 0.16 + intensity * 0.22;
  ctx.fillStyle = "rgba(79, 52, 35, 0.92)";
  ctx.beginPath();
  ctx.ellipse(0, 0, radius, radius * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.08 + intensity * 0.16;
  ctx.strokeStyle = "rgba(35, 24, 18, 0.9)";
  ctx.lineWidth = 2;
  for (let index = 0; index < 4; index += 1) {
    const angle = index * 1.7 + pulse * 0.4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * radius * 0.12, Math.sin(angle) * radius * 0.08);
    ctx.quadraticCurveTo(
      Math.cos(angle + 0.6) * radius * 0.42,
      Math.sin(angle + 0.6) * radius * 0.2,
      Math.cos(angle) * radius * 0.78,
      Math.sin(angle) * radius * 0.36,
    );
    ctx.stroke();
  }
}

function drawMyceliumGroundEffect(ctx, radius, intensity, pulse, effect) {
  const hunger = effect.hunger ?? 0;
  const feedStrength = effect.feedStrength ?? 0;
  const chargeStrength = effect.chargeStrength ?? 0;
  const feeding = feedStrength > 0.05;
  const charged = chargeStrength > 0.08;
  ctx.globalAlpha = 0.12 + intensity * 0.2;
  ctx.fillStyle = feeding
    ? "rgba(151, 109, 98, 0.9)"
    : charged
      ? "rgba(97, 143, 151, 0.84)"
      : hunger > 0.3
        ? "rgba(130, 105, 126, 0.86)"
        : "rgba(158, 137, 183, 0.9)";
  ctx.beginPath();
  ctx.ellipse(0, 0, radius, radius * 0.66, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.16 + intensity * 0.24 + feedStrength * 0.12;
  ctx.strokeStyle = feeding
    ? "rgba(214, 151, 104, 0.86)"
    : charged
      ? "rgba(143, 226, 223, 0.84)"
      : hunger > 0.3
        ? "rgba(177, 128, 94, 0.78)"
        : "rgba(220, 204, 230, 0.8)";
  ctx.lineWidth = 1.4 + feedStrength * 1.1 + chargeStrength * 0.6;
  const tendrils = 6 + Math.round(feedStrength * 4);
  for (let index = 0; index < tendrils; index += 1) {
    const angle = (Math.PI * 2 * index) / tendrils + pulse * 0.28;
    const length = radius * (0.42 + (index % 3) * 0.14 + hunger * 0.08 + feedStrength * 0.14);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(
      Math.cos(angle + 0.45) * length * 0.5,
      Math.sin(angle + 0.45) * length * 0.26,
      Math.cos(angle) * length,
      Math.sin(angle) * length * 0.48,
    );
    ctx.stroke();
  }

  if (charged) {
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.08 + chargeStrength * 0.22 + pulse * 0.05;
    ctx.strokeStyle = "rgba(161, 240, 229, 0.82)";
    ctx.lineWidth = 1;
    for (let arc = 0; arc < 3; arc += 1) {
      const y = (arc - 1) * radius * 0.1;
      ctx.beginPath();
      ctx.moveTo(-radius * 0.28, y);
      ctx.lineTo(-radius * 0.06, y - radius * 0.08);
      ctx.lineTo(radius * 0.12, y + radius * 0.06);
      ctx.lineTo(radius * 0.32, y - radius * 0.04);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "multiply";
  }
}

function drawChargeGroundEffect(ctx, radius, intensity, pulse, spent) {
  ctx.globalAlpha = spent ? 0.08 + intensity * 0.08 : 0.1 + intensity * 0.18;
  ctx.fillStyle = spent ? "rgba(61, 77, 78, 0.8)" : "rgba(63, 139, 145, 0.82)";
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.9, radius * 0.54, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = spent ? 0.1 : 0.18 + pulse * 0.14;
  ctx.strokeStyle = "rgba(157, 230, 230, 0.82)";
  ctx.lineWidth = 1.3;
  for (let index = 0; index < 3; index += 1) {
    const y = (index - 1) * radius * 0.14;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.42, y);
    ctx.lineTo(-radius * 0.12, y - radius * 0.12);
    ctx.lineTo(radius * 0.08, y + radius * 0.08);
    ctx.lineTo(radius * 0.44, y - radius * 0.06);
    ctx.stroke();
  }
}

function drawMineralDecayGroundEffect(ctx, radius, intensity, pulse) {
  ctx.globalAlpha = 0.08 + intensity * 0.14;
  ctx.fillStyle = "rgba(91, 84, 70, 0.88)";
  ctx.beginPath();
  ctx.ellipse(0, 0, radius, radius * 0.56, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.08 + pulse * 0.04;
  ctx.strokeStyle = "rgba(54, 48, 42, 0.7)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-radius * 0.5, -radius * 0.08);
  ctx.lineTo(-radius * 0.2, radius * 0.1);
  ctx.lineTo(radius * 0.18, -radius * 0.02);
  ctx.lineTo(radius * 0.46, radius * 0.12);
  ctx.stroke();
}

function drawMineralDustGroundEffect(ctx, radius, intensity, pulse, effect) {
  const old = effect.agePressure ?? 0;
  ctx.globalAlpha = 0.06 + intensity * 0.13;
  ctx.fillStyle = "rgba(83, 80, 71, 0.84)";
  ctx.beginPath();
  ctx.ellipse(0, 0, radius, radius * 0.52, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.08 + old * 0.12 + pulse * 0.03;
  ctx.fillStyle = "rgba(185, 176, 143, 0.72)";
  for (let chip = 0; chip < 6; chip += 1) {
    const angle = chip * 1.34 + old * 0.8;
    const distance = radius * (0.16 + (chip % 3) * 0.18);
    ctx.beginPath();
    ctx.ellipse(
      Math.cos(angle) * distance,
      Math.sin(angle) * distance * 0.42,
      1.4 + (chip % 3),
      0.8 + pulse * 0.35,
      -0.25,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}
