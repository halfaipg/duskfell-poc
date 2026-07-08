import path from "node:path";

import { validateApproval, validateProvenance } from "./provenance.js";
import {
  isNonEmptyString,
  isNonNegativeInteger,
  isObject,
  isPositiveInteger,
  isSafeRelativePath,
  isSha256Hex,
  isSubpath,
} from "./validation.js";

const ALLOWED_CELL_SIZES = new Set([64, 96, 128, 192]);
const ALLOWED_DIRECTIONS = new Set([
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
  "idle",
  "neutral",
  "front",
  "back",
  "left",
  "right",
]);
const ALLOWED_RENDER_LAYERS = new Set(["terrain", "prop", "actor", "equipment", "fx", "ui"]);
const ALLOWED_RENDER_SORTS = new Set(["footprint-y", "fixed", "screen-y"]);
const ALLOWED_SHADOW_KINDS = new Set(["ellipse", "none"]);

export function validateSheet(sheet, index, manifestDir, seenIds, errors) {
  const prefix = `sheets[${index}]`;
  if (!isObject(sheet)) {
    errors.push(`${prefix} must be an object`);
    return;
  }

  if (!isNonEmptyString(sheet.id)) {
    errors.push(`${prefix}.id must be a non-empty string`);
  } else if (seenIds.has(sheet.id)) {
    errors.push(`${prefix}.id ${JSON.stringify(sheet.id)} is duplicated`);
  } else {
    seenIds.add(sheet.id);
  }

  if (!isSafeRelativePath(sheet.image)) {
    errors.push(`${prefix}.image must be a safe relative PNG path`);
  } else {
    const resolved = path.resolve(manifestDir, sheet.image);
    if (!isSubpath(manifestDir, resolved)) {
      errors.push(`${prefix}.image must stay inside the manifest directory`);
    }
    if (path.extname(sheet.image).toLowerCase() !== ".png") {
      errors.push(`${prefix}.image must point to a PNG sheet`);
    }
  }
  if (!isSha256Hex(sheet.imageSha256)) {
    errors.push(`${prefix}.imageSha256 must be a lowercase SHA-256 hex digest`);
  }

  validateFrameGrid(sheet.frameGrid, prefix, errors);
  validateAnchor(sheet.anchor, sheet.frameGrid, prefix, errors);
  validateFootprint(sheet.footprint, prefix, errors);
  validateRender(sheet.render, sheet.frameGrid, prefix, errors);
  validateDirections(sheet.directions, sheet.frameGrid, prefix, errors);
  validateApproval(sheet.approval, prefix, errors);
  validateProvenance(sheet.provenance, sheet.approval, prefix, errors);
}

function validateFrameGrid(frameGrid, prefix, errors) {
  if (!isObject(frameGrid)) {
    errors.push(`${prefix}.frameGrid must be an object`);
    return;
  }

  for (const key of ["cellWidth", "cellHeight", "columns", "rows", "frameCount"]) {
    if (!isPositiveInteger(frameGrid[key])) {
      errors.push(`${prefix}.frameGrid.${key} must be a positive integer`);
    }
  }

  if (
    isPositiveInteger(frameGrid.cellWidth) &&
    isPositiveInteger(frameGrid.cellHeight) &&
    frameGrid.cellWidth !== frameGrid.cellHeight
  ) {
    errors.push(`${prefix}.frameGrid cells must be square transparent frames`);
  }

  if (isPositiveInteger(frameGrid.cellWidth) && !ALLOWED_CELL_SIZES.has(frameGrid.cellWidth)) {
    errors.push(
      `${prefix}.frameGrid.cellWidth must be one of ${[...ALLOWED_CELL_SIZES].join(", ")}`,
    );
  }

  if (
    isPositiveInteger(frameGrid.columns) &&
    isPositiveInteger(frameGrid.rows) &&
    isPositiveInteger(frameGrid.frameCount) &&
    frameGrid.frameCount > frameGrid.columns * frameGrid.rows
  ) {
    errors.push(`${prefix}.frameGrid.frameCount cannot exceed columns * rows`);
  }
}

function validateAnchor(anchor, frameGrid, prefix, errors) {
  if (!isObject(anchor)) {
    errors.push(`${prefix}.anchor must be an object`);
    return;
  }
  if (anchor.kind !== "foot") {
    errors.push(`${prefix}.anchor.kind must be foot`);
  }
  if (!isNonNegativeInteger(anchor.x) || !isNonNegativeInteger(anchor.y)) {
    errors.push(`${prefix}.anchor x/y must be non-negative integers`);
    return;
  }
  if (!isObject(frameGrid) || !isPositiveInteger(frameGrid.cellWidth)) return;

  if (anchor.x >= frameGrid.cellWidth || anchor.y >= frameGrid.cellHeight) {
    errors.push(`${prefix}.anchor must be inside the frame cell`);
  }
  if (anchor.y < Math.floor(frameGrid.cellHeight * 0.6)) {
    errors.push(`${prefix}.anchor.y should be in the lower 40% of the cell for foot anchoring`);
  }
}

function validateFootprint(footprint, prefix, errors) {
  if (!isObject(footprint)) {
    errors.push(`${prefix}.footprint must be an object`);
    return;
  }
  if (footprint.kind !== "diamond") {
    errors.push(`${prefix}.footprint.kind must be diamond`);
  }
  for (const key of ["widthTiles", "heightTiles"]) {
    if (typeof footprint[key] !== "number" || footprint[key] <= 0 || footprint[key] > 8) {
      errors.push(`${prefix}.footprint.${key} must be a number in (0, 8]`);
    }
  }
}

function validateRender(render, frameGrid, prefix, errors) {
  if (!isObject(render)) {
    errors.push(`${prefix}.render must be an object`);
    return;
  }

  if (!ALLOWED_RENDER_LAYERS.has(render.layer)) {
    errors.push(`${prefix}.render.layer must be one of ${[...ALLOWED_RENDER_LAYERS].join(", ")}`);
  }
  if (!ALLOWED_RENDER_SORTS.has(render.sort)) {
    errors.push(`${prefix}.render.sort must be one of ${[...ALLOWED_RENDER_SORTS].join(", ")}`);
  }
  if (!Number.isInteger(render.zBias) || Math.abs(render.zBias) > 1000) {
    errors.push(`${prefix}.render.zBias must be an integer between -1000 and 1000`);
  }
  if (
    render.scale !== undefined &&
    (typeof render.scale !== "number" || render.scale < 0.25 || render.scale > 2)
  ) {
    errors.push(`${prefix}.render.scale must be a number in [0.25, 2] when present`);
  }

  validateShadow(render.shadow, frameGrid, `${prefix}.render.shadow`, errors);
}

function validateShadow(shadow, frameGrid, prefix, errors) {
  if (!isObject(shadow)) {
    errors.push(`${prefix} must be an object`);
    return;
  }

  if (!ALLOWED_SHADOW_KINDS.has(shadow.kind)) {
    errors.push(`${prefix}.kind must be one of ${[...ALLOWED_SHADOW_KINDS].join(", ")}`);
    return;
  }
  if (shadow.kind === "none") return;

  for (const key of ["x", "y", "width", "height"]) {
    if (!isPositiveInteger(shadow[key])) {
      errors.push(`${prefix}.${key} must be a positive integer`);
    }
  }
  if (typeof shadow.opacity !== "number" || shadow.opacity < 0 || shadow.opacity > 1) {
    errors.push(`${prefix}.opacity must be a number in [0, 1]`);
  }

  if (!isObject(frameGrid) || !isPositiveInteger(frameGrid.cellWidth)) return;

  if (shadow.x >= frameGrid.cellWidth || shadow.y >= frameGrid.cellHeight) {
    errors.push(`${prefix} x/y must be inside the frame cell`);
  }
  if (shadow.width > frameGrid.cellWidth || shadow.height > frameGrid.cellHeight) {
    errors.push(`${prefix} width/height must fit inside the frame cell`);
  }
}

function validateDirections(directions, frameGrid, prefix, errors) {
  if (!Array.isArray(directions) || directions.length === 0) {
    errors.push(`${prefix}.directions must be a non-empty array`);
    return;
  }

  let totalFrames = 0;
  const seen = new Set();
  for (const [index, direction] of directions.entries()) {
    const directionPrefix = `${prefix}.directions[${index}]`;
    if (!isObject(direction)) {
      errors.push(`${directionPrefix} must be an object`);
      continue;
    }
    if (!ALLOWED_DIRECTIONS.has(direction.name)) {
      errors.push(`${directionPrefix}.name is not an allowed direction label`);
    } else if (seen.has(direction.name)) {
      errors.push(`${directionPrefix}.name ${direction.name} is duplicated`);
    } else {
      seen.add(direction.name);
    }
    if (!isNonNegativeInteger(direction.startFrame)) {
      errors.push(`${directionPrefix}.startFrame must be a non-negative integer`);
    }
    if (!isPositiveInteger(direction.frameCount)) {
      errors.push(`${directionPrefix}.frameCount must be a positive integer`);
    } else {
      totalFrames += direction.frameCount;
    }
  }

  if (
    isObject(frameGrid) &&
    isPositiveInteger(frameGrid.frameCount) &&
    totalFrames > frameGrid.frameCount
  ) {
    errors.push(`${prefix}.directions declare more frames than frameGrid.frameCount`);
  }
}
