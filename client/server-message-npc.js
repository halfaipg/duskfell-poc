import {
  isObject,
  normalizeColor,
  normalizeFiniteNumber,
  normalizePositiveInteger,
  normalizeText,
} from "./server-message-validators.js";

const NPC_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeNpc(npc, prefix) {
  if (!isObject(npc)) throw new Error(`${prefix} must be an object`);
  if (typeof npc.id !== "string" || !NPC_ID_RE.test(npc.id) || npc.id.length > 64) {
    throw new Error(`${prefix}.id must be lowercase kebab-case`);
  }
  return {
    id: `npc:${npc.id}`,
    npcId: npc.id,
    npc: true,
    name: normalizeText(npc.name, `${prefix}.name`),
    x: normalizeFiniteNumber(npc.x, `${prefix}.x`),
    y: normalizeFiniteNumber(npc.y, `${prefix}.y`),
    color: normalizeColor(npc.color, `${prefix}.color`),
    speech: npc.speech == null ? null : normalizeNpcSpeech(npc.speech, `${prefix}.speech`),
    demoDeeds: [],
    resources: {
      wood: 0,
      ore: 0,
      stone: 0,
      charge: 0,
      deadwood: 0,
      fiber: 0,
      mycelium: 0,
      spores: 0,
      seed: 0,
    },
    inventory: { capacitySlots: 1, items: [] },
  };
}

function normalizeNpcSpeech(speech, prefix) {
  if (!isObject(speech)) throw new Error(`${prefix} must be an object`);
  return {
    text: normalizeText(speech.text, `${prefix}.text`),
    untilTick: normalizePositiveInteger(speech.untilTick, `${prefix}.untilTick`),
  };
}
