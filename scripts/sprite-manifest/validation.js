import path from "node:path";

export function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

export function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

export function isSha256Hex(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function isSafeRelativePath(value) {
  return (
    isNonEmptyString(value) &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]+/).includes("..")
  );
}

export function isSubpath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
