import { MAX_INVENTORY_SLOTS } from "./server-message-constants.js";
import {
  isObject,
  normalizeArray,
  normalizeBoolean,
  normalizeBoundedAgeYears,
  normalizeBoundedResource,
  normalizeColor,
  normalizeFiniteNumber,
  normalizeOptionalBoundedResource,
  normalizePositiveInteger,
  normalizeText,
  normalizeUnitNumber,
  normalizeUuid,
} from "./server-message-validators.js";

export function normalizePlayer(player, prefix) {
  if (!isObject(player)) {
    throw new Error(`${prefix} must be an object`);
  }
  return {
    id: normalizeUuid(player.id, `${prefix}.id`),
    accountSubject:
      player.accountSubject == null
        ? null
        : normalizeText(player.accountSubject, `${prefix}.accountSubject`),
    name: normalizeText(player.name, `${prefix}.name`),
    x: normalizeFiniteNumber(player.x, `${prefix}.x`),
    y: normalizeFiniteNumber(player.y, `${prefix}.y`),
    color: normalizeColor(player.color, `${prefix}.color`),
    demoDeeds: normalizeArray(player.demoDeeds, `${prefix}.demoDeeds`, 32).map((deed, index) =>
      normalizeText(deed, `${prefix}.demoDeeds[${index}]`),
    ),
    resources: normalizeResources(player.resources, `${prefix}.resources`),
    inventory: normalizeInventory(player.inventory, `${prefix}.inventory`),
  };
}

function normalizeResources(resources, prefix) {
  if (!isObject(resources)) {
    throw new Error(`${prefix} must be an object`);
  }
  return {
    wood: normalizeBoundedResource(resources.wood, `${prefix}.wood`),
    ore: normalizeBoundedResource(resources.ore, `${prefix}.ore`),
    stone: normalizeOptionalBoundedResource(resources.stone, `${prefix}.stone`),
    charge: normalizeOptionalBoundedResource(resources.charge, `${prefix}.charge`),
    deadwood: normalizeOptionalBoundedResource(resources.deadwood, `${prefix}.deadwood`),
    fiber: normalizeOptionalBoundedResource(resources.fiber, `${prefix}.fiber`),
    mycelium: normalizeOptionalBoundedResource(resources.mycelium, `${prefix}.mycelium`),
    spores: normalizeOptionalBoundedResource(resources.spores, `${prefix}.spores`),
    seed: normalizeOptionalBoundedResource(resources.seed, `${prefix}.seed`),
  };
}

function normalizeInventory(inventory, prefix) {
  if (!isObject(inventory)) {
    throw new Error(`${prefix} must be an object`);
  }
  const capacitySlots = normalizePositiveInteger(inventory.capacitySlots, `${prefix}.capacitySlots`);
  if (capacitySlots > MAX_INVENTORY_SLOTS) {
    throw new Error(`${prefix}.capacitySlots exceeds maximum inventory slots`);
  }
  const items = normalizeArray(inventory.items, `${prefix}.items`, capacitySlots).map((item, index) =>
    normalizeInventoryItem(item, `${prefix}.items[${index}]`),
  );
  const itemIds = new Set();
  for (const item of items) {
    if (itemIds.has(item.itemId)) {
      throw new Error(`${prefix}.items contains duplicate itemId ${item.itemId}`);
    }
    itemIds.add(item.itemId);
  }
  return {
    capacitySlots,
    items,
  };
}

function normalizeInventoryItem(item, prefix) {
  if (!isObject(item)) {
    throw new Error(`${prefix} must be an object`);
  }
  const normalized = {
    itemId: normalizeText(item.itemId, `${prefix}.itemId`),
    label: normalizeText(item.label, `${prefix}.label`),
    quantity: normalizeBoundedResource(item.quantity, `${prefix}.quantity`),
  };
  if (item.lifecycle != null) {
    normalized.lifecycle = normalizeInventoryItemLifecycle(item.lifecycle, `${prefix}.lifecycle`);
  }
  return normalized;
}

function normalizeInventoryItemLifecycle(lifecycle, prefix) {
  if (!isObject(lifecycle)) {
    throw new Error(`${prefix} must be an object`);
  }
  return {
    family: normalizeText(lifecycle.family, `${prefix}.family`),
    stage: normalizeText(lifecycle.stage, `${prefix}.stage`),
    ageYears: normalizeBoundedAgeYears(lifecycle.ageYears, `${prefix}.ageYears`),
    health: normalizeUnitNumber(lifecycle.health, `${prefix}.health`),
    decay: normalizeUnitNumber(lifecycle.decay, `${prefix}.decay`),
    compostable: normalizeBoolean(lifecycle.compostable, `${prefix}.compostable`),
  };
}
