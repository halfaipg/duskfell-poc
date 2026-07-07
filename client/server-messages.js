const MAX_PLAYERS = 512;
const MAX_OBJECTS = 4096;
const MAX_INVENTORY_SLOTS = 32;
const MAX_RESOURCE_COUNT = 999;
const MAX_LIFECYCLE_AGE_YEARS = 1_000_000;
const MAX_TEXT = 128;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const OBJECT_KINDS = new Set([
  "registrar",
  "forge",
  "grove",
  "ore",
  "shrine",
  "saplingTree",
  "deadwood",
  "myceliumPatch",
  "fieldCoil",
  "ruin",
]);
const RESOURCE_KINDS = new Set(["wood", "ore", "stone", "charge", "deadwood", "fiber", "mycelium", "spores", "seed"]);
const TERRAIN_PROFILE = "duskfell-terrain-v1";
const TERRAIN_MATERIALS = new Set(["grass", "field", "dirt", "stone", "water", "settlement"]);

export function parseServerMessage(raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    throw new Error("server message is not valid JSON");
  }

  if (!isObject(message) || typeof message.type !== "string") {
    throw new Error("server message type is missing");
  }

  if (message.type === "welcome") {
    return {
      type: "welcome",
      playerId: normalizeUuid(message.playerId, "welcome.playerId"),
      snapshot: normalizeSnapshot(message.snapshot, "welcome.snapshot"),
    };
  }
  if (message.type === "snapshot") {
    return {
      type: "snapshot",
      ...normalizeSnapshot(message, "snapshot"),
    };
  }
  if (message.type === "notice") {
    return {
      type: "notice",
      level: normalizeNoticeLevel(message.level),
      message: normalizeText(message.message, "notice.message"),
    };
  }

  throw new Error(`unsupported server message type ${message.type}`);
}

function normalizeSnapshot(snapshot, prefix) {
  if (!isObject(snapshot)) {
    throw new Error(`${prefix} must be an object`);
  }

  return {
    tick: normalizeNonNegativeInteger(snapshot.tick, `${prefix}.tick`),
    map: normalizeMap(snapshot.map, `${prefix}.map`),
    players: normalizeArray(snapshot.players, `${prefix}.players`, MAX_PLAYERS).map((player, index) =>
      normalizePlayer(player, `${prefix}.players[${index}]`),
    ),
    objects: normalizeArray(snapshot.objects, `${prefix}.objects`, MAX_OBJECTS).map((object, index) =>
      normalizeObject(object, `${prefix}.objects[${index}]`),
    ),
    settlement: normalizeSettlement(snapshot.settlement, `${prefix}.settlement`),
  };
}

function normalizeMap(map, prefix) {
  if (!isObject(map)) {
    throw new Error(`${prefix} must be an object`);
  }
  return {
    width: normalizePositiveNumber(map.width, `${prefix}.width`),
    height: normalizePositiveNumber(map.height, `${prefix}.height`),
    safeZoneRadius: normalizeNonNegativeNumber(map.safeZoneRadius, `${prefix}.safeZoneRadius`),
    terrain: normalizeTerrain(map.terrain, `${prefix}.terrain`),
  };
}

function normalizeTerrain(terrain, prefix) {
  if (!isObject(terrain)) {
    throw new Error(`${prefix} must be an object`);
  }
  if (terrain.profile !== TERRAIN_PROFILE) {
    throw new Error(`${prefix}.profile is not supported`);
  }
  const unitsPerTile = normalizePositiveInteger(terrain.unitsPerTile, `${prefix}.unitsPerTile`);
  const tileWidth = normalizePositiveInteger(terrain.tileWidth, `${prefix}.tileWidth`);
  const tileHeight = normalizePositiveInteger(terrain.tileHeight, `${prefix}.tileHeight`);
  if (unitsPerTile !== 64 || tileWidth !== 64 || tileHeight !== 64) {
    throw new Error(`${prefix} projection does not match the client`);
  }
  const heightScale = normalizePositiveNumber(terrain.heightScale, `${prefix}.heightScale`);
  if (heightScale !== 6) {
    throw new Error(`${prefix}.heightScale does not match the client`);
  }
  const minElevation = normalizeInteger(terrain.minElevation, `${prefix}.minElevation`);
  const maxElevation = normalizeInteger(terrain.maxElevation, `${prefix}.maxElevation`);
  const waterLevel = normalizeInteger(terrain.waterLevel, `${prefix}.waterLevel`);
  if (minElevation > maxElevation) {
    throw new Error(`${prefix}.minElevation must be <= maxElevation`);
  }
  if (waterLevel < minElevation || waterLevel > maxElevation) {
    throw new Error(`${prefix}.waterLevel must be inside the elevation range`);
  }
  const materials = normalizeArray(terrain.materials, `${prefix}.materials`, TERRAIN_MATERIALS.size);
  if (materials.length !== TERRAIN_MATERIALS.size) {
    throw new Error(`${prefix}.materials must declare the canonical material set`);
  }
  const materialSet = new Set();
  for (const material of materials) {
    if (!TERRAIN_MATERIALS.has(material)) {
      throw new Error(`${prefix}.materials contains unsupported material ${material}`);
    }
    if (materialSet.has(material)) {
      throw new Error(`${prefix}.materials contains duplicate material ${material}`);
    }
    materialSet.add(material);
  }

  return {
    profile: terrain.profile,
    seed: normalizeNonNegativeInteger(terrain.seed, `${prefix}.seed`),
    unitsPerTile,
    tileWidth,
    tileHeight,
    heightScale,
    minElevation,
    maxElevation,
    waterLevel,
    maxWalkableStep: normalizePositiveInteger(terrain.maxWalkableStep, `${prefix}.maxWalkableStep`),
    materials,
  };
}

function normalizePlayer(player, prefix) {
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
  return {
    itemId: normalizeText(item.itemId, `${prefix}.itemId`),
    label: normalizeText(item.label, `${prefix}.label`),
    quantity: normalizeBoundedResource(item.quantity, `${prefix}.quantity`),
  };
}

function normalizeObject(object, prefix) {
  if (!isObject(object)) {
    throw new Error(`${prefix} must be an object`);
  }
  if (!OBJECT_KINDS.has(object.kind)) {
    throw new Error(`${prefix}.kind is not supported`);
  }
  return {
    id: normalizeText(object.id, `${prefix}.id`),
    kind: object.kind,
    label: normalizeText(object.label, `${prefix}.label`),
    x: normalizeFiniteNumber(object.x, `${prefix}.x`),
    y: normalizeFiniteNumber(object.y, `${prefix}.y`),
    radius: normalizePositiveNumber(object.radius, `${prefix}.radius`),
    resources: normalizeArray(object.resources ?? [], `${prefix}.resources`, 8).map((resource, index) =>
      normalizeObjectResource(resource, `${prefix}.resources[${index}]`),
    ),
    lifecycle:
      object.lifecycle == null
        ? null
        : normalizeObjectLifecycle(object.lifecycle, `${prefix}.lifecycle`),
  };
}

function normalizeObjectResource(resource, prefix) {
  if (!isObject(resource)) {
    throw new Error(`${prefix} must be an object`);
  }
  if (!RESOURCE_KINDS.has(resource.kind)) {
    throw new Error(`${prefix}.kind is not supported`);
  }
  const amount = normalizeBoundedResource(resource.amount, `${prefix}.amount`);
  const maxAmount = normalizeBoundedResource(resource.maxAmount, `${prefix}.maxAmount`);
  if (amount > maxAmount) {
    throw new Error(`${prefix}.amount must be <= maxAmount`);
  }
  return {
    kind: resource.kind,
    amount,
    maxAmount,
  };
}

function normalizeObjectLifecycle(lifecycle, prefix) {
  if (!isObject(lifecycle)) {
    throw new Error(`${prefix} must be an object`);
  }
  return {
    family: normalizeText(lifecycle.family, `${prefix}.family`),
    stage: normalizeText(lifecycle.stage, `${prefix}.stage`),
    species: lifecycle.species == null ? null : normalizeText(lifecycle.species, `${prefix}.species`),
    ageYears: lifecycle.ageYears == null ? null : normalizeBoundedAgeYears(lifecycle.ageYears, `${prefix}.ageYears`),
    health: normalizeUnitNumber(lifecycle.health, `${prefix}.health`),
    growth: normalizeUnitNumber(lifecycle.growth, `${prefix}.growth`),
    decay: normalizeUnitNumber(lifecycle.decay, `${prefix}.decay`),
  };
}

function normalizeSettlement(settlement, prefix) {
  if (!isObject(settlement)) {
    throw new Error(`${prefix} must be an object`);
  }
  return {
    chainEnabled: normalizeBoolean(settlement.chainEnabled, `${prefix}.chainEnabled`),
    pendingJobs: normalizeNonNegativeInteger(settlement.pendingJobs, `${prefix}.pendingJobs`),
    confirmedJobs: normalizeNonNegativeInteger(settlement.confirmedJobs, `${prefix}.confirmedJobs`),
    ownedAssets: normalizeNonNegativeInteger(settlement.ownedAssets, `${prefix}.ownedAssets`),
    latestReceipt:
      settlement.latestReceipt == null
        ? null
        : normalizeReceipt(settlement.latestReceipt, `${prefix}.latestReceipt`),
  };
}

function normalizeReceipt(receipt, prefix) {
  if (!isObject(receipt)) {
    throw new Error(`${prefix} must be an object`);
  }
  return {
    jobId: normalizeUuid(receipt.jobId, `${prefix}.jobId`),
    playerId: normalizeUuid(receipt.playerId, `${prefix}.playerId`),
    accountSubject:
      receipt.accountSubject == null
        ? null
        : normalizeText(receipt.accountSubject, `${prefix}.accountSubject`),
    assetId: normalizeText(receipt.assetId, `${prefix}.assetId`),
    status: normalizeText(receipt.status, `${prefix}.status`),
    chainTx: receipt.chainTx == null ? null : normalizeText(receipt.chainTx, `${prefix}.chainTx`),
  };
}

function normalizeNoticeLevel(level) {
  if (level === "info" || level === "warn" || level === "error") return level;
  throw new Error("notice.level is not supported");
}

function normalizeArray(value, field, maxLength) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (value.length > maxLength) {
    throw new Error(`${field} exceeds maximum length`);
  }
  return value;
}

function normalizeUuid(value, field) {
  if (typeof value === "string" && UUID_RE.test(value)) return value;
  throw new Error(`${field} must be a UUID`);
}

function normalizeText(value, field) {
  if (typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT) return value;
  throw new Error(`${field} must be a bounded string`);
}

function normalizeColor(value, field) {
  if (typeof value === "string" && COLOR_RE.test(value)) return value;
  throw new Error(`${field} must be a hex color`);
}

function normalizeBoolean(value, field) {
  if (typeof value === "boolean") return value;
  throw new Error(`${field} must be a boolean`);
}

function normalizeFiniteNumber(value, field) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`${field} must be finite`);
}

function normalizePositiveNumber(value, field) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  throw new Error(`${field} must be positive`);
}

function normalizeNonNegativeNumber(value, field) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  throw new Error(`${field} must be non-negative`);
}

function normalizeNonNegativeInteger(value, field) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error(`${field} must be a non-negative integer`);
}

function normalizePositiveInteger(value, field) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  throw new Error(`${field} must be a positive integer`);
}

function normalizeInteger(value, field) {
  if (Number.isSafeInteger(value)) return value;
  throw new Error(`${field} must be an integer`);
}

function normalizeBoundedResource(value, field) {
  const normalized = normalizeNonNegativeInteger(value, field);
  if (normalized <= MAX_RESOURCE_COUNT) return normalized;
  throw new Error(`${field} exceeds maximum resource count`);
}

function normalizeBoundedAgeYears(value, field) {
  const normalized = normalizeNonNegativeInteger(value, field);
  if (normalized <= MAX_LIFECYCLE_AGE_YEARS) return normalized;
  throw new Error(`${field} exceeds maximum lifecycle age`);
}

function normalizeOptionalBoundedResource(value, field) {
  if (value == null) return 0;
  return normalizeBoundedResource(value, field);
}

function normalizeUnitNumber(value, field) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) return value;
  throw new Error(`${field} must be a unit number`);
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
