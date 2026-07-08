import { OBJECT_KINDS, RESOURCE_KINDS } from "./server-message-constants.js";
import {
  isObject,
  normalizeArray,
  normalizeBoundedAgeYears,
  normalizeBoundedResource,
  normalizeFiniteNumber,
  normalizePositiveNumber,
  normalizeText,
  normalizeUnitNumber,
} from "./server-message-validators.js";

export function normalizeObject(object, prefix) {
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
    ageYears:
      lifecycle.ageYears == null
        ? null
        : normalizeBoundedAgeYears(lifecycle.ageYears, `${prefix}.ageYears`),
    health: normalizeUnitNumber(lifecycle.health, `${prefix}.health`),
    growth: normalizeUnitNumber(lifecycle.growth, `${prefix}.growth`),
    decay: normalizeUnitNumber(lifecycle.decay, `${prefix}.decay`),
  };
}
