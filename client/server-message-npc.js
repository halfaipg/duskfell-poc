import {
  isObject,
  normalizeFiniteNumber,
  normalizePositiveNumber,
  normalizeText,
  normalizeUuid,
} from "./server-message-validators.js";

export function normalizeNpc(npc, prefix) {
  if (!isObject(npc)) {
    throw new Error(`${prefix} must be an object`);
  }
  const normalized = {
    id: normalizeText(npc.id, `${prefix}.id`),
    name: normalizeText(npc.name, `${prefix}.name`),
    x: normalizeFiniteNumber(npc.x, `${prefix}.x`),
    y: normalizeFiniteNumber(npc.y, `${prefix}.y`),
    radius: normalizePositiveNumber(npc.radius, `${prefix}.radius`),
    partyPlayerId: null,
  };
  if (npc.partyPlayerId != null) {
    normalized.partyPlayerId = normalizeUuid(npc.partyPlayerId, `${prefix}.partyPlayerId`);
  }
  return normalized;
}
