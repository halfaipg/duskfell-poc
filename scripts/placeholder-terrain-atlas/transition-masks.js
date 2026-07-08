import { CELL as cell } from "./catalog.js";

export function transitionMaskWeight(x, y, mask) {
  const u = x / (cell - 1);
  const v = y / (cell - 1);
  const depth = 0.42;
  const feather = 0.12;
  if (mask.edge === "north") return falloff(v, depth, feather);
  if (mask.edge === "east") return falloff(1 - u, depth, feather);
  if (mask.edge === "south") return falloff(1 - v, depth, feather);
  if (mask.edge === "west") return falloff(u, depth, feather);
  if (mask.corner === "northEast") return Math.min(falloff(v, depth, feather), falloff(1 - u, depth, feather));
  if (mask.corner === "southEast") return Math.min(falloff(1 - v, depth, feather), falloff(1 - u, depth, feather));
  if (mask.corner === "southWest") return Math.min(falloff(1 - v, depth, feather), falloff(u, depth, feather));
  if (mask.corner === "northWest") return Math.min(falloff(v, depth, feather), falloff(u, depth, feather));
  return 0;
}

export function transitionAccentPoint(cx, cy, mask, seed) {
  const jitter = (value, range) => ((value & 63) / 63 - 0.5) * range;
  if (mask.edge === "north") return [cx + jitter(seed, 48), cy - 21 + jitter(seed >>> 6, 9)];
  if (mask.edge === "east") return [cx + 21 + jitter(seed, 9), cy + jitter(seed >>> 6, 48)];
  if (mask.edge === "south") return [cx + jitter(seed, 48), cy + 21 + jitter(seed >>> 6, 9)];
  if (mask.edge === "west") return [cx - 21 + jitter(seed, 9), cy + jitter(seed >>> 6, 48)];
  if (mask.corner === "northEast") return [cx + 19 + jitter(seed, 15), cy - 19 + jitter(seed >>> 6, 15)];
  if (mask.corner === "southEast") return [cx + 19 + jitter(seed, 15), cy + 19 + jitter(seed >>> 6, 15)];
  if (mask.corner === "southWest") return [cx - 19 + jitter(seed, 15), cy + 19 + jitter(seed >>> 6, 15)];
  return [cx - 19 + jitter(seed, 15), cy - 19 + jitter(seed >>> 6, 15)];
}

function falloff(distance, depth, feather) {
  if (distance <= depth - feather) return 0.42;
  if (distance >= depth) return 0;
  return ((depth - distance) / feather) * 0.42;
}
