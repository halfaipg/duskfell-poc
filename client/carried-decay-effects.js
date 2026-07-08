export const CARRIED_DECAY_EFFECT_LIMIT = 6;
export const CARRIED_CHARGE_EFFECT_LIMIT = 5;

export function carriedDecayEffect(player, options = {}) {
  if (!player?.inventory || !Array.isArray(player.inventory.items)) return null;
  const limit = options.limit ?? CARRIED_DECAY_EFFECT_LIMIT;
  let compostPressure = 0;
  let sporePressure = 0;

  for (const item of player.inventory.items) {
    const quantity = boundedQuantity(item.quantity);
    if (quantity <= 0) continue;
    const lifecycle = item.lifecycle;
    if (lifecycle?.compostable) {
      compostPressure += clamp01(lifecycle.decay) * Math.min(quantity, 3);
    }
    if (item.itemId === "spores") {
      sporePressure += Math.min(quantity, 6) / 6;
    }
  }

  const intensity = clamp01(compostPressure / 3 + sporePressure * 0.55);
  if (intensity <= 0) return null;

  return {
    playerId: player.id,
    kind: "carried-spores",
    intensity,
    moteCount: Math.max(1, Math.min(limit, Math.ceil(1 + intensity * (limit - 1)))),
    radius: 14 + intensity * 22,
    lift: 26 + intensity * 20,
    compostPressure: clamp01(compostPressure / 3),
    sporePressure: clamp01(sporePressure),
  };
}

export function carriedChargeEffect(player, options = {}) {
  const inventoryItems = Array.isArray(player?.inventory?.items) ? player.inventory.items : [];
  const limit = options.limit ?? CARRIED_CHARGE_EFFECT_LIMIT;
  let charge = boundedQuantity(player?.resources?.charge);

  for (const item of inventoryItems) {
    if (item.itemId === "charge") {
      charge += boundedQuantity(item.quantity);
    }
  }

  if (charge <= 0) return null;
  const intensity = clamp01(charge / 5);

  return {
    playerId: player.id,
    kind: "carried-charge",
    intensity,
    sparkCount: Math.max(1, Math.min(limit, Math.ceil(1 + intensity * (limit - 1)))),
    radius: 12 + intensity * 18,
    lift: 18 + intensity * 16,
    charge,
  };
}

function boundedQuantity(quantity) {
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 0;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
