import { isNonEmptyString, isObject } from "./validation.js";

const ALLOWED_PAPERDOLL_ROLES = new Set(["player", "npc"]);
const ALLOWED_PAPERDOLL_SLOTS = new Set([
  "underlayer",
  "hair",
  "shirt",
  "legs",
  "boots",
  "armor",
  "cloak",
  "weapon",
  "shield",
  "fx",
]);

export function validatePaperdolls(paperdolls, sheets, errors) {
  if (paperdolls === undefined) return;
  if (!Array.isArray(paperdolls)) {
    errors.push("paperdolls must be an array when present");
    return;
  }

  const sheetById = new Map(sheets.map((sheet) => [sheet?.id, sheet]));
  const seenIds = new Set();
  for (const [index, definition] of paperdolls.entries()) {
    const prefix = `paperdolls[${index}]`;
    validatePaperdollDefinition(definition, prefix, sheetById, seenIds, errors);
  }
}

function validatePaperdollDefinition(definition, prefix, sheetById, seenIds, errors) {
  if (!isObject(definition)) {
    errors.push(`${prefix} must be an object`);
    return;
  }
  if (!isNonEmptyString(definition.id)) {
    errors.push(`${prefix}.id must be a non-empty string`);
  } else if (seenIds.has(definition.id)) {
    errors.push(`${prefix}.id ${JSON.stringify(definition.id)} is duplicated`);
  } else {
    seenIds.add(definition.id);
  }
  if (!ALLOWED_PAPERDOLL_ROLES.has(definition.role)) {
    errors.push(`${prefix}.role must be one of ${[...ALLOWED_PAPERDOLL_ROLES].join(", ")}`);
  }
  if (definition.label !== undefined && !isNonEmptyString(definition.label)) {
    errors.push(`${prefix}.label must be a non-empty string when present`);
  }
  if (!isNonEmptyString(definition.baseSheetId)) {
    errors.push(`${prefix}.baseSheetId must be a non-empty string`);
    return;
  }

  const base = sheetById.get(definition.baseSheetId);
  if (!base) {
    errors.push(`${prefix}.baseSheetId ${JSON.stringify(definition.baseSheetId)} was not found in sheets`);
    return;
  }
  if (base.render?.layer !== "actor") {
    errors.push(`${prefix}.baseSheetId must reference an actor sheet`);
  }

  if (!Array.isArray(definition.layers)) {
    errors.push(`${prefix}.layers must be an array`);
    return;
  }
  const seenSlots = new Set();
  for (const [layerIndex, layer] of definition.layers.entries()) {
    validatePaperdollLayer(layer, `${prefix}.layers[${layerIndex}]`, base, sheetById, seenSlots, errors);
  }
}

function validatePaperdollLayer(layer, prefix, base, sheetById, seenSlots, errors) {
  if (!isObject(layer)) {
    errors.push(`${prefix} must be an object`);
    return;
  }
  if (!ALLOWED_PAPERDOLL_SLOTS.has(layer.slot)) {
    errors.push(`${prefix}.slot must be one of ${[...ALLOWED_PAPERDOLL_SLOTS].join(", ")}`);
  } else if (seenSlots.has(layer.slot)) {
    errors.push(`${prefix}.slot ${layer.slot} is duplicated in this paperdoll`);
  } else {
    seenSlots.add(layer.slot);
  }
  if (!isNonEmptyString(layer.sheetId)) {
    errors.push(`${prefix}.sheetId must be a non-empty string`);
    return;
  }

  const sheet = sheetById.get(layer.sheetId);
  if (!sheet) {
    errors.push(`${prefix}.sheetId ${JSON.stringify(layer.sheetId)} was not found in sheets`);
    return;
  }
  if (!["equipment", "actor", "fx"].includes(sheet.render?.layer)) {
    errors.push(`${prefix}.sheetId must reference an equipment, actor, or fx sheet`);
  }
  validatePaperdollSheetCompatibility(base, sheet, prefix, errors);
}

function validatePaperdollSheetCompatibility(base, sheet, prefix, errors) {
  const geometryKeys = ["cellWidth", "cellHeight", "columns", "rows", "frameCount"];
  for (const key of geometryKeys) {
    if (sheet.frameGrid?.[key] !== base.frameGrid?.[key]) {
      errors.push(`${prefix}.sheetId frameGrid.${key} must match the base body`);
    }
  }
  if (sheet.anchor?.x !== base.anchor?.x || sheet.anchor?.y !== base.anchor?.y) {
    errors.push(`${prefix}.sheetId foot anchor must match the base body`);
  }
  if (sheet.render?.sort !== base.render?.sort) {
    errors.push(`${prefix}.sheetId render.sort must match the base body`);
  }
  if ((sheet.render?.scale ?? null) !== (base.render?.scale ?? null)) {
    errors.push(`${prefix}.sheetId render.scale must match the base body`);
  }
  validatePaperdollDirections(base.directions, sheet.directions, prefix, errors);
}

function validatePaperdollDirections(baseDirections, sheetDirections, prefix, errors) {
  if (!Array.isArray(baseDirections) || !Array.isArray(sheetDirections)) return;
  if (sheetDirections.length !== baseDirections.length) {
    errors.push(`${prefix}.sheetId directions must match the base body`);
    return;
  }
  for (const baseDirection of baseDirections) {
    const sheetDirection = sheetDirections.find((direction) => direction?.name === baseDirection.name);
    if (!sheetDirection) {
      errors.push(`${prefix}.sheetId missing base direction ${baseDirection.name}`);
      continue;
    }
    if (
      sheetDirection.startFrame !== baseDirection.startFrame ||
      sheetDirection.frameCount !== baseDirection.frameCount
    ) {
      errors.push(`${prefix}.sheetId direction ${baseDirection.name} range must match the base body`);
    }
  }
}
