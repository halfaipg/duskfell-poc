import { PROJECTION } from "./projection.js";

const MANIFEST_SCHEMA_VERSION = "sundermere-sprite-manifest-v1";
const ALLOWED_RENDER_LAYERS = new Set(["terrain", "prop", "actor", "equipment", "fx", "ui"]);
const ALLOWED_RENDER_SORTS = new Set(["footprint-y", "screen-y", "fixed"]);
const ALLOWED_SHADOW_KINDS = new Set(["ellipse", "none"]);

export function selectSpriteSheet(manifest, sheetId, directionName) {
  assertManifestProjection(manifest);
  if (!Array.isArray(manifest.sheets)) {
    throw new Error("sprite manifest sheets must be an array");
  }

  const sheet = manifest.sheets.find((candidate) => candidate.id === sheetId);
  if (!sheet) {
    throw new Error(`sprite sheet ${sheetId} was not found`);
  }

  const imagePath = safeSpriteImagePath(sheet.image);
  const imageSha256 = normalizeSha256(sheet.imageSha256);
  const frameGrid = normalizeFrameGrid(sheet.frameGrid);
  const anchor = normalizeAnchor(sheet.anchor, frameGrid);
  const render = normalizeRender(sheet.render, frameGrid);
  const direction = selectDirection(sheet.directions, directionName, frameGrid);

  return {
    imagePath,
    imageSha256,
    cellWidth: frameGrid.cellWidth,
    cellHeight: frameGrid.cellHeight,
    anchor,
    render,
    startFrame: direction.startFrame,
    frameCount: direction.frameCount,
  };
}

function normalizeSha256(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("sprite sheet imageSha256 must be a lowercase SHA-256 hex digest");
  }
  return value;
}

function assertManifestProjection(manifest) {
  if (!isObject(manifest)) {
    throw new Error("sprite manifest must be an object");
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`sprite manifest schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`);
  }
  if (!isObject(manifest.projection)) {
    throw new Error("sprite manifest projection must be an object");
  }
  if (
    manifest.projection.kind !== PROJECTION.kind ||
    manifest.projection.tileWidth !== PROJECTION.tileW ||
    manifest.projection.tileHeight !== PROJECTION.tileH ||
    manifest.projection.tileAspectRatio !== PROJECTION.tileAspectRatio ||
    manifest.projection.axisAngleDegrees !== PROJECTION.axisAngleDegrees ||
    manifest.projection.heightAxis !== PROJECTION.heightAxis ||
    manifest.projection.unitsPerTile !== PROJECTION.unitsPerTile
  ) {
    throw new Error("sprite manifest projection does not match the client projection");
  }
}

function safeSpriteImagePath(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error("sprite sheet image must be a non-empty normalized path");
  }
  if (!value.endsWith(".png") || value.includes("\\") || value.includes("?") || value.includes("#")) {
    throw new Error("sprite sheet image must be a plain relative PNG path");
  }
  if (value.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    throw new Error("sprite sheet image must not be absolute or URL-like");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("sprite sheet image path contains an unsafe segment");
  }
  return value;
}

function normalizeFrameGrid(frameGrid) {
  if (!isObject(frameGrid)) {
    throw new Error("sprite sheet frameGrid must be an object");
  }
  const { cellWidth, cellHeight, columns, rows, frameCount } = frameGrid;
  for (const [key, value] of Object.entries({ cellWidth, cellHeight, columns, rows, frameCount })) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`sprite sheet frameGrid.${key} must be a positive integer`);
    }
  }
  if (cellWidth !== cellHeight) {
    throw new Error("sprite sheet frameGrid cells must be square");
  }
  if (frameCount > columns * rows) {
    throw new Error("sprite sheet frameGrid frameCount exceeds grid capacity");
  }
  return { cellWidth, cellHeight, columns, rows, frameCount };
}

function normalizeAnchor(anchor, frameGrid) {
  if (!isObject(anchor) || anchor.kind !== "foot") {
    throw new Error("sprite sheet anchor must be a foot anchor");
  }
  if (!Number.isInteger(anchor.x) || !Number.isInteger(anchor.y)) {
    throw new Error("sprite sheet anchor x/y must be integers");
  }
  if (anchor.x < 0 || anchor.y < 0 || anchor.x >= frameGrid.cellWidth || anchor.y >= frameGrid.cellHeight) {
    throw new Error("sprite sheet anchor must be inside the frame cell");
  }
  return { kind: "foot", x: anchor.x, y: anchor.y };
}

function normalizeRender(render, frameGrid) {
  if (!isObject(render)) {
    throw new Error("sprite sheet render metadata must be an object");
  }
  if (!ALLOWED_RENDER_LAYERS.has(render.layer)) {
    throw new Error("sprite sheet render layer is not supported by the client");
  }
  if (!ALLOWED_RENDER_SORTS.has(render.sort)) {
    throw new Error("sprite sheet render sort is not supported by the client");
  }
  if (!Number.isInteger(render.zBias) || Math.abs(render.zBias) > 1000) {
    throw new Error("sprite sheet render zBias must be an integer between -1000 and 1000");
  }
  return {
    layer: render.layer,
    sort: render.sort,
    zBias: render.zBias,
    shadow: normalizeShadow(render.shadow, frameGrid),
  };
}

function normalizeShadow(shadow, frameGrid) {
  if (!isObject(shadow) || !ALLOWED_SHADOW_KINDS.has(shadow.kind)) {
    throw new Error("sprite sheet shadow kind is not supported by the client");
  }
  if (shadow.kind === "none") {
    return { kind: "none" };
  }

  const { x, y, width, height, opacity } = shadow;
  for (const [key, value] of Object.entries({ x, y, width, height })) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`sprite sheet shadow.${key} must be a positive integer`);
    }
  }
  if (x >= frameGrid.cellWidth || y >= frameGrid.cellHeight) {
    throw new Error("sprite sheet shadow anchor must be inside the frame cell");
  }
  if (width > frameGrid.cellWidth || height > frameGrid.cellHeight) {
    throw new Error("sprite sheet shadow must fit inside the frame cell");
  }
  if (typeof opacity !== "number" || opacity < 0 || opacity > 1) {
    throw new Error("sprite sheet shadow opacity must be in [0, 1]");
  }
  return { kind: "ellipse", x, y, width, height, opacity };
}

function selectDirection(directions, directionName, frameGrid) {
  if (!Array.isArray(directions)) {
    throw new Error("sprite sheet directions must be an array");
  }
  const direction = directions.find((candidate) => candidate.name === directionName);
  if (!direction) {
    throw new Error(`sprite sheet direction ${directionName} was not found`);
  }
  if (!Number.isInteger(direction.startFrame) || direction.startFrame < 0) {
    throw new Error("sprite sheet direction startFrame must be a non-negative integer");
  }
  if (!Number.isInteger(direction.frameCount) || direction.frameCount <= 0) {
    throw new Error("sprite sheet direction frameCount must be a positive integer");
  }
  if (direction.startFrame + direction.frameCount > frameGrid.frameCount) {
    throw new Error("sprite sheet direction range exceeds frameGrid.frameCount");
  }
  return {
    name: direction.name,
    startFrame: direction.startFrame,
    frameCount: direction.frameCount,
  };
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
