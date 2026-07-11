// Mirrors the server's TALK_RADIUS in sim/model.rs; the server re-validates
// range on every interaction, this only drives client prompts.
export const NPC_TALK_RADIUS = 96;

export function nearestNpc(npcs, playerPosition, options = {}) {
  if (!Array.isArray(npcs) || !playerPosition) return null;
  const radius = options.radius ?? NPC_TALK_RADIUS;
  let nearest = null;
  let nearestDistanceSquared = radius * radius;
  for (const npc of npcs) {
    if (!npc || typeof npc.id !== "string") continue;
    const dx = (npc.x ?? 0) - playerPosition.x;
    const dy = (npc.y ?? 0) - playerPosition.y;
    const currentDistanceSquared = dx * dx + dy * dy;
    if (currentDistanceSquared > nearestDistanceSquared) continue;
    nearest = npc;
    nearestDistanceSquared = currentDistanceSquared;
  }
  return nearest;
}

export function npcPartyPrompt(npc, playerId) {
  if (!npc) return null;
  if (npc.partyPlayerId && playerId && npc.partyPlayerId === playerId) {
    return {
      npcId: npc.id,
      label: `T: talk to ${npc.name} · P: part ways`,
      action: "partyLeave",
    };
  }
  if (npc.partyPlayerId) {
    return { npcId: npc.id, label: `${npc.name} is traveling with someone`, action: null };
  }
  return {
    npcId: npc.id,
    label: `T: talk to ${npc.name} · P: invite to party`,
    action: "partyInvite",
  };
}
