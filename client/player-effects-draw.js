import { PROJECTION } from "./projection.js";
import { carriedChargeEffect, carriedDecayEffect } from "./carried-decay-effects.js";
import { playerFootstepEffect } from "./player-footstep-effects.js";
import { terrainTileAt } from "./terrain.js";
import { stableIndex } from "./player-draw-utils.js";

export function drawPlayerFootfall(
  ctx,
  terrain,
  point,
  motion,
  renderPosition,
  grounding = null,
  playerKey = "",
) {
  const material =
    grounding?.material ?? terrainMaterialAtWorld(terrain, renderPosition.x, renderPosition.y);
  const effect = playerFootstepEffect({
    material,
    motion,
    grounding,
    playerId: playerKey,
  });
  if (!effect) return;
  const imprint = effect.imprint;
  const x = point.x + imprint.x;
  const y = point.y + imprint.y;

  ctx.save();
  ctx.globalCompositeOperation = effect.composite;
  ctx.globalAlpha = imprint.alpha;
  ctx.translate(x, y);
  ctx.rotate(imprint.rotation);
  ctx.beginPath();
  ctx.ellipse(0, 0, imprint.width, imprint.height, 0, 0, Math.PI * 2);
  ctx.fillStyle = imprint.fill;
  ctx.fill();

  ctx.globalAlpha = imprint.lineAlpha;
  ctx.strokeStyle = imprint.stroke;
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.moveTo(-imprint.width * 0.65, imprint.height * 0.12);
  ctx.lineTo(imprint.width * 0.58, -imprint.height * 0.08);
  ctx.stroke();
  ctx.restore();

  drawPlayerFootstepParticles(ctx, point, effect);
}

export function drawCarriedChargeEffect(ctx, player, point, now) {
  const effect = carriedChargeEffect(player);
  if (!effect) return;

  const seed = stableIndex(player.id);
  const t = now / 1000;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = `rgba(142, 228, 231, ${0.18 + effect.intensity * 0.32})`;
  ctx.lineWidth = 1.1 + effect.intensity * 0.7;

  for (let i = 0; i < effect.sparkCount; i += 1) {
    const phase = seed * 0.51 + i * 2.11 + t * (3.8 + i * 0.27);
    const orbit = effect.radius * (0.36 + ((seed + i * 23) % 47) / 96);
    const x = point.x + Math.cos(phase) * orbit;
    const y = point.y - effect.lift + Math.sin(phase * 1.7) * orbit * 0.5;
    const kink = 4 + effect.intensity * 5;

    ctx.beginPath();
    ctx.moveTo(x - Math.cos(phase) * kink, y - Math.sin(phase) * kink * 0.55);
    ctx.lineTo(x + Math.sin(phase) * kink * 0.55, y + Math.cos(phase) * kink * 0.4);
    ctx.lineTo(
      x + Math.cos(phase + 0.8) * kink,
      y + Math.sin(phase + 0.8) * kink * 0.55,
    );
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, 1.1 + effect.intensity * 1.1, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(239, 217, 139, ${0.12 + effect.intensity * 0.22})`;
    ctx.fill();
  }

  ctx.restore();
}

export function drawCarriedDecayEffect(ctx, player, point, now) {
  const effect = carriedDecayEffect(player);
  if (!effect) return;

  const seed = stableIndex(player.id);
  const t = now / 1000;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";

  for (let i = 0; i < effect.moteCount; i += 1) {
    const phase = seed * 0.37 + i * 1.73 + t * (0.62 + i * 0.04);
    const orbit = effect.radius * (0.34 + ((i * 37 + seed) % 53) / 90);
    const x = point.x + Math.cos(phase) * orbit;
    const y = point.y - effect.lift + Math.sin(phase * 1.28) * orbit * 0.42;
    const alpha = 0.14 + effect.intensity * 0.24 + Math.sin(phase * 2.1) * 0.04;

    ctx.beginPath();
    ctx.arc(x, y, 1.25 + effect.intensity * 1.35, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(177, 211, 142, ${Math.max(0.08, Math.min(0.42, alpha))})`;
    ctx.fill();

    if (effect.compostPressure > 0.45 && i % 2 === 0) {
      ctx.beginPath();
      ctx.arc(x + 1.8, y + 1.2, 0.8 + effect.compostPressure * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(98, 117, 84, ${0.1 + effect.compostPressure * 0.16})`;
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawPlayerFootstepParticles(ctx, point, effect) {
  ctx.save();
  ctx.globalCompositeOperation = effect.composite;
  for (const particle of effect.particles) {
    ctx.globalAlpha = particle.alpha;
    ctx.strokeStyle = particle.color;
    ctx.fillStyle = particle.color;
    const x = point.x + particle.x;
    const y = point.y + particle.y;
    if (particle.kind === "spark") {
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(particle.rotation) * particle.length * 0.45, y);
      ctx.lineTo(
        x + Math.cos(particle.rotation) * particle.length * 0.55,
        y - Math.sin(particle.rotation) * particle.length,
      );
      ctx.stroke();
    } else if (particle.kind === "blade") {
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(x, y + 1);
      ctx.lineTo(x + particle.lean, y - particle.length);
      ctx.stroke();
    } else if (particle.kind === "ripple") {
      ctx.beginPath();
      ctx.ellipse(x, y, particle.width, particle.height, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, particle.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function terrainMaterialAtWorld(terrain, worldX, worldY) {
  if (!terrain) return "grass";
  const units = terrain.profile?.unitsPerTile ?? PROJECTION.unitsPerTile;
  const tile = terrainTileAt(terrain, Math.floor(worldX / units), Math.floor(worldY / units));
  return tile?.material ?? "grass";
}
