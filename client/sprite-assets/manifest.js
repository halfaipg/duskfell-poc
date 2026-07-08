import { PROJECTION } from "../projection.js";

export const MANIFEST_SCHEMA_VERSION = "sundermere-sprite-manifest-v1";
export const ALLOWED_RENDER_LAYERS = new Set(["terrain", "prop", "actor", "equipment", "fx", "ui"]);
export const ALLOWED_RENDER_SORTS = new Set(["footprint-y", "screen-y", "fixed"]);
export const ALLOWED_SHADOW_KINDS = new Set(["ellipse", "none"]);

export function assertManifestProjection(manifest) {
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

export function normalizeSha256(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("sprite sheet imageSha256 must be a lowercase SHA-256 hex digest");
  }
  return value;
}

export function safeSpriteImagePath(value) {
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

export function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
