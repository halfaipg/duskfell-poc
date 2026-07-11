import { MAX_NPCS, MAX_OBJECTS, MAX_PLAYERS } from "./server-message-constants.js";
import { normalizeNpc } from "./server-message-npc.js";
import { normalizeObject } from "./server-message-object.js";
import { normalizePlayer } from "./server-message-player.js";
import { normalizeSettlement } from "./server-message-settlement.js";
import { normalizeMap } from "./server-message-terrain.js";
import { isObject, normalizeArray, normalizeNonNegativeInteger } from "./server-message-validators.js";

export function normalizeSnapshot(snapshot, prefix) {
  if (!isObject(snapshot)) {
    throw new Error(`${prefix} must be an object`);
  }

  return {
    tick: normalizeNonNegativeInteger(snapshot.tick, `${prefix}.tick`),
    map: normalizeMap(snapshot.map, `${prefix}.map`),
    players: normalizeArray(snapshot.players, `${prefix}.players`, MAX_PLAYERS).map((player, index) =>
      normalizePlayer(player, `${prefix}.players[${index}]`),
    ),
    // Older servers omit npcs entirely; treat that as an empty list.
    npcs: normalizeArray(snapshot.npcs ?? [], `${prefix}.npcs`, MAX_NPCS).map((npc, index) =>
      normalizeNpc(npc, `${prefix}.npcs[${index}]`),
    ),
    objects: normalizeArray(snapshot.objects, `${prefix}.objects`, MAX_OBJECTS).map((object, index) =>
      normalizeObject(object, `${prefix}.objects[${index}]`),
    ),
    settlement: normalizeSettlement(snapshot.settlement, `${prefix}.settlement`),
  };
}
