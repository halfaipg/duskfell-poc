import { PROJECTION } from "./projection.js";
import { terrainTileAt } from "./terrain.js";

export function playerGroundingAtWorld(terrain, position, motion = {}) {
  if (!terrain || !position) return defaultPlayerGrounding();
  const units = terrain.profile?.unitsPerTile ?? PROJECTION.unitsPerTile;
  const tile = terrainTileAt(terrain, Math.floor(position.x / units), Math.floor(position.y / units));
  return playerGroundingForTile(tile, motion);
}

export function playerGroundingForTile(tile, motion = {}) {
  if (!tile) return defaultPlayerGrounding();
  const slopeX = finite(tile.height?.slopeX);
  const slopeY = finite(tile.height?.slopeY);
  const range = Math.max(0, finite(tile.height?.range));
  const screenSlopeX = (slopeX - slopeY) * PROJECTION.halfW;
  const screenSlopeY = (slopeX + slopeY) * PROJECTION.halfH;
  const slopeMagnitude = Math.hypot(screenSlopeX, screenSlopeY) / PROJECTION.tileW;
  const moving = Boolean(motion.moving);
  const footfallStrength = Math.max(0, Math.min(1, finite(motion.footfallStrength)));
  const contact = Math.max(slopeMagnitude, range * 0.18);

  return {
    material: tile.material ?? "grass",
    slopeX,
    slopeY,
    range,
    contact,
    shadowOffsetX: cleanZero(clamp(-screenSlopeX * 0.08, -3.5, 3.5)),
    shadowOffsetY: clamp(Math.abs(screenSlopeY) * 0.035 + range * 0.28, 0, 2.4),
    shadowScaleX: clamp(1 + contact * 0.1, 1, 1.18),
    shadowScaleY: clamp(1 - contact * 0.08, 0.84, 1),
    bodyOffsetY: moving ? clamp(contact * 0.45 * footfallStrength, 0, 0.85) : 0,
    footfallOffsetY: clamp(range * 0.55 + Math.abs(screenSlopeY) * 0.025, 0, 2.8),
  };
}

function defaultPlayerGrounding() {
  return {
    material: "grass",
    slopeX: 0,
    slopeY: 0,
    range: 0,
    contact: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowScaleX: 1,
    shadowScaleY: 1,
    bodyOffsetY: 0,
    footfallOffsetY: 0,
  };
}

function finite(value) {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cleanZero(value) {
  return Math.abs(value) < 0.000001 ? 0 : value;
}
