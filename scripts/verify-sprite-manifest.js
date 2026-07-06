import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PROJECTION } from "../client/projection.js";

const DEFAULT_MANIFEST = "assets/sprites/manifest.json";
const SPRITE_SCHEMA_VERSION = "sundermere-sprite-manifest-v1";
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
const ALLOWED_APPROVAL_STATES = new Set(["placeholder", "review", "approved", "rejected"]);
const ALLOWED_PROVENANCE_METHODS = new Set([
  "ai-generated",
  "hand-authored",
  "commissioned",
  "deterministic-local",
]);
const ALLOWED_TOOL_REVIEW_STATUSES = new Set(["approved-internal", "approved-production"]);
const ALLOWED_RENDER_LAYERS = new Set(["terrain", "prop", "actor", "equipment", "fx", "ui"]);
const ALLOWED_RENDER_SORTS = new Set(["footprint-y", "fixed", "screen-y"]);
const ALLOWED_SHADOW_KINDS = new Set(["ellipse", "none"]);
const DISALLOWED_CLEAN_ROOM_PROMPT_TERMS =
  /\b(ultima|uo|britain|moongate|broadsword|ea)\b/i;
const DISALLOWED_PROJECTION_PROMPT_TERMS =
  /\b(isometric|dimetric|64\s*x\s*32|128\s*x\s*64|2\s*:\s*1|rpg[-\s]?maker\s+iso|classic\s+iso)\b/i;
const DISALLOWED_COMMERCIAL_STYLE_PROMPT_TERMS =
  /\b(zelda|stardew|diablo|runescape|tibia|albion online|world of warcraft|warcraft)\b/i;
const QUARANTINED_TOOL_TERMS = [
  {
    pattern: /\b(chargen|antumdeluge\/chargen)\b/i,
    reason: "third-party base-art provenance risk",
  },
  {
    pattern: /\b(sheet-agent|subhad2218\/sheet-agent)\b/i,
    reason: "mis-tagged spreadsheet agent, not a sprite generator",
  },
  {
    pattern: /\b(svg-symbol-sprite|svg-spritify|astro-svgs|ngx-sprite)\b/i,
    reason: "SVG/icon spriter, not a raster game sprite generator",
  },
  {
    pattern: /\b(maartengr\/sprite-generator)\b/i,
    reason: "no-license/stale reference implementation",
  },
];

export async function verifySpriteManifest(manifestPath = DEFAULT_MANIFEST) {
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifestDir = path.dirname(absoluteManifestPath);
  const manifest = JSON.parse(await readFile(absoluteManifestPath, "utf8"));
  const errors = [];
  const warnings = [];

  validateManifest(manifest, absoluteManifestPath, manifestDir, errors, warnings);

  if (Array.isArray(manifest.sheets)) {
    await Promise.all(
      manifest.sheets.map((sheet, index) =>
        validateSheetImage(sheet, index, manifestDir, errors),
      ),
    );
  }

  return {
    ok: errors.length === 0,
    manifestPath: absoluteManifestPath,
    sheetCount: Array.isArray(manifest.sheets) ? manifest.sheets.length : 0,
    errors,
    warnings,
  };
}

function validateManifest(manifest, manifestPath, manifestDir, errors, warnings) {
  if (!isObject(manifest)) {
    errors.push(`${manifestPath}: manifest must be an object`);
    return;
  }

  if (manifest.schemaVersion !== SPRITE_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion must be ${JSON.stringify(SPRITE_SCHEMA_VERSION)}, got ${JSON.stringify(
        manifest.schemaVersion,
      )}`,
    );
  }

  validateProjection(manifest.projection, errors);

  if (!Array.isArray(manifest.sheets)) {
    errors.push("sheets must be an array");
    return;
  }

  const seenIds = new Set();
  for (const [index, sheet] of manifest.sheets.entries()) {
    validateSheet(sheet, index, manifestDir, seenIds, errors);
  }

  if (manifest.sheets.length === 0) {
    warnings.push("manifest has no sheets yet; asset contract is present but no art is approved");
  }
}

function validateProjection(projection, errors) {
  if (!isObject(projection)) {
    errors.push("projection must be an object");
    return;
  }

  if (projection.kind !== PROJECTION.kind) {
    errors.push(`projection.kind must be ${PROJECTION.kind}`);
  }
  if (projection.tileWidth !== PROJECTION.tileW) {
    errors.push(`projection.tileWidth must match client projection (${PROJECTION.tileW})`);
  }
  if (projection.tileHeight !== PROJECTION.tileH) {
    errors.push(`projection.tileHeight must match client projection (${PROJECTION.tileH})`);
  }
  if (projection.tileWidth !== projection.tileHeight) {
    errors.push("projection tiles must be 1:1 diamonds, not 2:1 dimetric tiles");
  }
  if (projection.tileAspectRatio !== PROJECTION.tileAspectRatio) {
    errors.push(
      `projection.tileAspectRatio must match client projection (${PROJECTION.tileAspectRatio})`,
    );
  }
  if (projection.axisAngleDegrees !== PROJECTION.axisAngleDegrees) {
    errors.push(
      `projection.axisAngleDegrees must match client projection (${PROJECTION.axisAngleDegrees})`,
    );
  }
  if (projection.heightAxis !== PROJECTION.heightAxis) {
    errors.push(`projection.heightAxis must match client projection (${PROJECTION.heightAxis})`);
  }
  if (projection.unitsPerTile !== PROJECTION.unitsPerTile) {
    errors.push(
      `projection.unitsPerTile must match client projection (${PROJECTION.unitsPerTile})`,
    );
  }
}

function validateSheet(sheet, index, manifestDir, seenIds, errors) {
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

  if (isObject(frameGrid) && isPositiveInteger(frameGrid.frameCount) && totalFrames > frameGrid.frameCount) {
    errors.push(`${prefix}.directions declare more frames than frameGrid.frameCount`);
  }
}

function validateProvenance(provenance, approval, prefix, errors) {
  if (!isObject(provenance)) {
    errors.push(`${prefix}.provenance must be an object`);
    return;
  }

  if (provenance.cleanRoom !== true) {
    errors.push(`${prefix}.provenance.cleanRoom must be true`);
  }
  for (const key of ["source", "createdAt", "license", "reviewer"]) {
    if (!isNonEmptyString(provenance[key])) {
      errors.push(`${prefix}.provenance.${key} must be a non-empty string`);
    }
  }

  if (!isNonEmptyString(provenance.prompt)) {
    errors.push(`${prefix}.provenance.prompt must be a non-empty string`);
  } else {
    validatePromptText(provenance.prompt, `${prefix}.provenance.prompt`, errors);
  }

  if (
    provenance.negativePrompt !== undefined &&
    !isNonEmptyString(provenance.negativePrompt)
  ) {
    errors.push(`${prefix}.provenance.negativePrompt must be a non-empty string when present`);
  }
  if (
    typeof provenance.negativePrompt === "string" &&
    DISALLOWED_CLEAN_ROOM_PROMPT_TERMS.test(provenance.negativePrompt)
  ) {
    errors.push(
      `${prefix}.provenance.negativePrompt contains disallowed UO-derived reference terms`,
    );
  }

  const isPlaceholder = isObject(approval) && approval.state === "placeholder";
  if (isPlaceholder) return;

  if (!ALLOWED_PROVENANCE_METHODS.has(provenance.method)) {
    errors.push(
      `${prefix}.provenance.method must be one of ${[...ALLOWED_PROVENANCE_METHODS].join(", ")} for non-placeholder sheets`,
    );
  }

  for (const key of ["tool", "toolVersion", "sourceHash", "termsSnapshot"]) {
    if (!isNonEmptyString(provenance[key])) {
      errors.push(`${prefix}.provenance.${key} must be a non-empty string for non-placeholder sheets`);
    }
  }
  validateToolIdentity(provenance, prefix, errors);
  validateToolReview(provenance.toolReview, prefix, errors);

  if (provenance.method === "ai-generated") {
    for (const key of ["model", "modelVersion", "seed"]) {
      if (!isNonEmptyString(provenance[key]) && typeof provenance[key] !== "number") {
        errors.push(`${prefix}.provenance.${key} is required for AI-generated sheets`);
      }
    }
  }
}

function validateToolIdentity(provenance, prefix, errors) {
  const identity = [
    provenance.tool,
    provenance.source,
    provenance.termsSnapshot,
    provenance.toolReview?.sourceUrl,
  ]
    .filter((value) => typeof value === "string")
    .join(" ");

  for (const { pattern, reason } of QUARANTINED_TOOL_TERMS) {
    if (pattern.test(identity)) {
      errors.push(`${prefix}.provenance.tool is quarantined: ${reason}`);
    }
  }
}

function validateToolReview(toolReview, prefix, errors) {
  if (!isObject(toolReview)) {
    errors.push(
      `${prefix}.provenance.toolReview must record the reviewed generator/tool status for non-placeholder sheets`,
    );
    return;
  }

  if (!ALLOWED_TOOL_REVIEW_STATUSES.has(toolReview.status)) {
    errors.push(
      `${prefix}.provenance.toolReview.status must be one of ${[...ALLOWED_TOOL_REVIEW_STATUSES].join(", ")}`,
    );
  }
  for (const key of ["reviewedAt", "reviewer", "sourceUrl", "risk"]) {
    if (!isNonEmptyString(toolReview[key])) {
      errors.push(`${prefix}.provenance.toolReview.${key} must be a non-empty string`);
    }
  }
  if (isNonEmptyString(toolReview.sourceUrl)) {
    try {
      const url = new URL(toolReview.sourceUrl);
      if (!["http:", "https:"].includes(url.protocol)) {
        errors.push(`${prefix}.provenance.toolReview.sourceUrl must be http or https`);
      }
    } catch {
      errors.push(`${prefix}.provenance.toolReview.sourceUrl must be a valid URL`);
    }
  }
}

function validatePromptText(prompt, prefix, errors) {
  if (DISALLOWED_CLEAN_ROOM_PROMPT_TERMS.test(prompt)) {
    errors.push(`${prefix} contains disallowed UO-derived reference terms`);
  }
  if (DISALLOWED_PROJECTION_PROMPT_TERMS.test(prompt)) {
    errors.push(
      `${prefix} contains projection drift terms; use positive military-plan-oblique 1:1 language and put rejected defaults in negativePrompt`,
    );
  }
  if (DISALLOWED_COMMERCIAL_STYLE_PROMPT_TERMS.test(prompt)) {
    errors.push(`${prefix} contains commercial game/style reference terms`);
  }
}

function validateApproval(approval, prefix, errors) {
  if (!isObject(approval)) {
    errors.push(`${prefix}.approval must be an object`);
    return;
  }

  if (!ALLOWED_APPROVAL_STATES.has(approval.state)) {
    errors.push(`${prefix}.approval.state must be one of ${[...ALLOWED_APPROVAL_STATES].join(", ")}`);
  }
  if (approval.state === "approved") {
    if (!isNonEmptyString(approval.reviewer)) {
      errors.push(`${prefix}.approval.reviewer is required for approved sheets`);
    }
    if (!isNonEmptyString(approval.approvedAt)) {
      errors.push(`${prefix}.approval.approvedAt is required for approved sheets`);
    }
  }
}

async function validateSheetImage(sheet, index, manifestDir, errors) {
  if (!isObject(sheet) || !isSafeRelativePath(sheet.image) || !isObject(sheet.frameGrid)) return;

  const prefix = `sheets[${index}]`;
  const imagePath = path.resolve(manifestDir, sheet.image);
  if (!isSubpath(manifestDir, imagePath)) return;

  let dimensions;
  let imageBytes;
  try {
    imageBytes = await readFile(imagePath);
    dimensions = readPngDimensions(imageBytes);
  } catch (err) {
    errors.push(`${prefix}.image could not be read as PNG: ${err.message}`);
    return;
  }

  const expectedWidth = sheet.frameGrid.columns * sheet.frameGrid.cellWidth;
  const expectedHeight = sheet.frameGrid.rows * sheet.frameGrid.cellHeight;
  if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
    errors.push(
      `${prefix}.image dimensions ${dimensions.width}x${dimensions.height} do not match declared grid ${expectedWidth}x${expectedHeight}`,
    );
  }
  if (isSha256Hex(sheet.imageSha256)) {
    const actualHash = sha256Hex(imageBytes);
    if (actualHash !== sheet.imageSha256) {
      errors.push(
        `${prefix}.imageSha256 ${sheet.imageSha256} does not match actual image hash ${actualHash}`,
      );
    }
  }
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function readPngDimensions(buffer) {
  if (buffer.length < 24) {
    throw new Error("file is too small for a PNG header");
  }
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [index, byte] of signature.entries()) {
    if (buffer[index] !== byte) {
      throw new Error("file does not have a PNG signature");
    }
  }
  if (buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("PNG is missing an IHDR chunk");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isSha256Hex(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isSafeRelativePath(value) {
  return (
    isNonEmptyString(value) &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]+/).includes("..")
  );
}

function isSubpath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function main() {
  const manifestPath = process.argv[2] ?? DEFAULT_MANIFEST;
  const result = await verifySpriteManifest(manifestPath);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
