import { MAX_LIFECYCLE_AGE_YEARS, MAX_RESOURCE_COUNT, MAX_TEXT } from "./server-message-constants.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export function normalizeNoticeLevel(level) {
  if (level === "info" || level === "warn" || level === "error") return level;
  throw new Error("notice.level is not supported");
}

export function normalizeArray(value, field, maxLength) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (value.length > maxLength) {
    throw new Error(`${field} exceeds maximum length`);
  }
  return value;
}

export function normalizeUuid(value, field) {
  if (typeof value === "string" && UUID_RE.test(value)) return value;
  throw new Error(`${field} must be a UUID`);
}

export function normalizeText(value, field) {
  if (typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT) return value;
  throw new Error(`${field} must be a bounded string`);
}

export function normalizeColor(value, field) {
  if (typeof value === "string" && COLOR_RE.test(value)) return value;
  throw new Error(`${field} must be a hex color`);
}

export function normalizeBoolean(value, field) {
  if (typeof value === "boolean") return value;
  throw new Error(`${field} must be a boolean`);
}

export function normalizeFiniteNumber(value, field) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`${field} must be finite`);
}

export function normalizePositiveNumber(value, field) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  throw new Error(`${field} must be positive`);
}

export function normalizeNonNegativeNumber(value, field) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  throw new Error(`${field} must be non-negative`);
}

export function normalizeNonNegativeInteger(value, field) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error(`${field} must be a non-negative integer`);
}

export function normalizePositiveInteger(value, field) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  throw new Error(`${field} must be a positive integer`);
}

export function normalizeInteger(value, field) {
  if (Number.isSafeInteger(value)) return value;
  throw new Error(`${field} must be an integer`);
}

export function normalizeBoundedResource(value, field) {
  const normalized = normalizeNonNegativeInteger(value, field);
  if (normalized <= MAX_RESOURCE_COUNT) return normalized;
  throw new Error(`${field} exceeds maximum resource count`);
}

export function normalizeBoundedAgeYears(value, field) {
  const normalized = normalizeNonNegativeInteger(value, field);
  if (normalized <= MAX_LIFECYCLE_AGE_YEARS) return normalized;
  throw new Error(`${field} exceeds maximum lifecycle age`);
}

export function normalizeOptionalBoundedResource(value, field) {
  if (value == null) return 0;
  return normalizeBoundedResource(value, field);
}

export function normalizeUnitNumber(value, field) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) return value;
  throw new Error(`${field} must be a unit number`);
}

export function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
