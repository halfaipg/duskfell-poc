import { isObject } from "./manifest.js";
import { selectSpriteSheet } from "./sheet.js";

export const PAPERDOLL_LAYER_ORDER = [
  "cloak",
  "body",
  "underlayer",
  "hair",
  "shirt",
  "legs",
  "boots",
  "armor",
  "weapon",
  "shield",
  "fx",
];

export function selectPaperdollStack(manifest, definition, directionName) {
  if (!isObject(definition)) {
    throw new Error("paperdoll definition must be an object");
  }
  if (typeof definition.baseSheetId !== "string" || definition.baseSheetId.length === 0) {
    throw new Error("paperdoll definition baseSheetId must be a non-empty string");
  }
  const base = selectSpriteSheet(manifest, definition.baseSheetId, directionName);
  if (base.render.layer !== "actor") {
    throw new Error("paperdoll base sheet must render on the actor layer");
  }

  const rawLayers = Array.isArray(definition.layers) ? definition.layers : [];
  const layers = [
    normalizePaperdollLayer("body", definition.baseSheetId, base),
    ...rawLayers.map((layer, index) => {
      if (!isObject(layer)) {
        throw new Error(`paperdoll layer ${index} must be an object`);
      }
      if (!PAPERDOLL_LAYER_ORDER.includes(layer.slot)) {
        throw new Error(`paperdoll layer ${index} uses unsupported slot`);
      }
      if (layer.slot === "body") {
        throw new Error("paperdoll overlay layers must not use the body slot");
      }
      const sheet = selectSpriteSheet(manifest, layer.sheetId, directionName);
      assertPaperdollOverlayCompatible(base, sheet, layer.slot);
      return normalizePaperdollLayer(layer.slot, layer.sheetId, sheet);
    }),
  ];

  layers.sort(
    (a, b) =>
      PAPERDOLL_LAYER_ORDER.indexOf(a.slot) - PAPERDOLL_LAYER_ORDER.indexOf(b.slot) ||
      a.sheetId.localeCompare(b.sheetId),
  );
  return {
    direction: directionName,
    baseSheetId: definition.baseSheetId,
    cellWidth: base.cellWidth,
    cellHeight: base.cellHeight,
    anchor: base.anchor,
    footprint: base.footprint,
    render: base.render,
    animation: base.animation,
    layers,
  };
}

function normalizePaperdollLayer(slot, sheetId, sheet) {
  return {
    slot,
    sheetId,
    imagePath: sheet.imagePath,
    imageSha256: sheet.imageSha256,
    cellWidth: sheet.cellWidth,
    cellHeight: sheet.cellHeight,
    columns: sheet.columns,
    rows: sheet.rows,
    startFrame: sheet.startFrame,
    frameCount: sheet.frameCount,
    render: sheet.render,
  };
}

function assertPaperdollOverlayCompatible(base, sheet, slot) {
  if (sheet.render.layer !== "equipment" && sheet.render.layer !== "actor" && sheet.render.layer !== "fx") {
    throw new Error(`paperdoll ${slot} layer must render as equipment, actor, or fx`);
  }
  if (sheet.cellWidth !== base.cellWidth || sheet.cellHeight !== base.cellHeight) {
    throw new Error(`paperdoll ${slot} layer frame grid must match the base body`);
  }
  if (sheet.columns !== base.columns || sheet.rows !== base.rows) {
    throw new Error(`paperdoll ${slot} layer sheet dimensions must match the base body`);
  }
  if (sheet.frameCount !== base.frameCount) {
    throw new Error(`paperdoll ${slot} layer frame count must match the base body`);
  }
  if (sheet.startFrame !== base.startFrame || sheet.frameCount !== base.frameCount) {
    throw new Error(`paperdoll ${slot} layer direction range must match the base body`);
  }
  if (sheet.anchor.x !== base.anchor.x || sheet.anchor.y !== base.anchor.y) {
    throw new Error(`paperdoll ${slot} layer foot anchor must match the base body`);
  }
  if (sheet.render.sort !== base.render.sort) {
    throw new Error(`paperdoll ${slot} layer render sort must match the base body`);
  }
  if ((sheet.render.scale ?? null) !== (base.render.scale ?? null)) {
    throw new Error(`paperdoll ${slot} layer render scale must match the base body`);
  }
}
