export function playerFootstepEffect({ material = "grass", motion = {}, grounding = null, playerId = "" } = {}) {
  const strength = clamp01(motion.footfallStrength ?? 0);
  if (!motion.moving || strength <= 0.02) return null;

  const style = footstepStyleForMaterial(material);
  const side = motion.footfallSide || 1;
  const seed = stableIndex(String(playerId));
  const pulse = Math.min(1, strength);
  const x = side * style.sideOffset;
  const y = style.yOffset + (grounding?.footfallOffsetY ?? 0);
  const width = style.width * (0.72 + pulse * 0.42);
  const height = style.height * (0.68 + pulse * 0.32);

  return {
    material,
    side,
    strength: pulse,
    composite: style.composite,
    imprint: {
      x,
      y,
      width,
      height,
      rotation: side * style.rotation,
      fill: style.fill,
      stroke: style.stroke,
      alpha: style.alpha * pulse,
      lineAlpha: style.lineAlpha * pulse,
    },
    particles: footstepParticles(style, side, seed, pulse),
  };
}

export function footstepStyleForMaterial(material) {
  const styles = {
    dirt: {
      family: "dust",
      fill: "rgba(119, 82, 54, 0.72)",
      stroke: "rgba(67, 45, 31, 0.7)",
      alpha: 0.3,
      lineAlpha: 0.18,
      width: 8.6,
      height: 2.9,
      sideOffset: 7,
      yOffset: 4,
      rotation: 0.12,
      composite: "multiply",
      particleCount: 5,
    },
    stone: {
      family: "chip",
      fill: "rgba(196, 185, 151, 0.46)",
      stroke: "rgba(75, 72, 63, 0.6)",
      alpha: 0.18,
      lineAlpha: 0.16,
      width: 6,
      height: 1.8,
      sideOffset: 6,
      yOffset: 3,
      rotation: 0.08,
      composite: "source-over",
      particleCount: 3,
    },
    settlement: {
      family: "chip",
      fill: "rgba(188, 170, 130, 0.44)",
      stroke: "rgba(78, 67, 52, 0.52)",
      alpha: 0.16,
      lineAlpha: 0.14,
      width: 6.5,
      height: 1.9,
      sideOffset: 6,
      yOffset: 3,
      rotation: 0.08,
      composite: "multiply",
      particleCount: 3,
    },
    field: {
      family: "spark",
      fill: "rgba(95, 159, 155, 0.5)",
      stroke: "rgba(54, 107, 104, 0.58)",
      alpha: 0.2,
      lineAlpha: 0.18,
      width: 7,
      height: 2.2,
      sideOffset: 6,
      yOffset: 3,
      rotation: 0.1,
      composite: "screen",
      particleCount: 4,
    },
    water: {
      family: "ripple",
      fill: "rgba(163, 211, 212, 0.44)",
      stroke: "rgba(111, 165, 173, 0.48)",
      alpha: 0.22,
      lineAlpha: 0.18,
      width: 8,
      height: 2.4,
      sideOffset: 7,
      yOffset: 4,
      rotation: 0.07,
      composite: "source-over",
      particleCount: 3,
    },
    grass: {
      family: "blade",
      fill: "rgba(72, 104, 54, 0.54)",
      stroke: "rgba(35, 68, 34, 0.52)",
      alpha: 0.2,
      lineAlpha: 0.16,
      width: 7,
      height: 2.2,
      sideOffset: 6,
      yOffset: 4,
      rotation: 0.1,
      composite: "multiply",
      particleCount: 4,
    },
  };
  return styles[material] ?? styles.grass;
}

function footstepParticles(style, side, seed, strength) {
  const count = Math.max(0, Math.min(6, Math.round(style.particleCount * (0.45 + strength * 0.55))));
  const particles = [];
  for (let index = 0; index < count; index += 1) {
    const jitter = hashUnit(seed, index);
    const lateral = side * (style.sideOffset + 1.5 + jitter * 6);
    const forward = style.yOffset - 1.5 + hashUnit(seed + 17, index) * 5;
    particles.push(particleForFamily(style.family, lateral, forward, side, jitter, strength, index));
  }
  return particles;
}

function particleForFamily(family, x, y, side, jitter, strength, index) {
  if (family === "spark") {
    return {
      kind: "spark",
      x,
      y,
      length: 3 + strength * 5 + jitter * 2,
      rotation: side * (0.35 + jitter * 0.8),
      alpha: 0.22 + strength * 0.38,
      color: index % 2 === 0 ? "rgba(166, 247, 239, 1)" : "rgba(240, 214, 128, 1)",
    };
  }
  if (family === "chip") {
    return {
      kind: "chip",
      x,
      y,
      radius: 0.8 + jitter * 1.4,
      alpha: 0.12 + strength * 0.16,
      color: "rgba(92, 86, 72, 1)",
    };
  }
  if (family === "ripple") {
    return {
      kind: "ripple",
      x,
      y,
      width: 4 + jitter * 5,
      height: 1.2 + strength * 1.8,
      alpha: 0.14 + strength * 0.2,
      color: "rgba(174, 220, 218, 1)",
    };
  }
  if (family === "blade") {
    return {
      kind: "blade",
      x,
      y,
      length: 3 + jitter * 5,
      lean: side * (1.5 + jitter * 2.5),
      alpha: 0.12 + strength * 0.16,
      color: "rgba(77, 119, 58, 1)",
    };
  }
  return {
    kind: "dust",
    x,
    y,
    radius: 1.4 + jitter * 3.2,
    alpha: 0.1 + strength * 0.18,
    color: "rgba(132, 93, 61, 1)",
  };
}

function stableIndex(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function hashUnit(seed, salt) {
  let value = Math.imul((seed + salt * 101 + 17) | 0, 1664525) + 1013904223;
  value ^= value >>> 16;
  return ((value >>> 0) % 1000) / 999;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
