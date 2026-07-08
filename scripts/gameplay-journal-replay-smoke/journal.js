export function findGameplayEvents(events, playerId) {
  return {
    wood: events.find(
      (event) =>
        event.kind?.type === "resourceGathered" &&
        event.kind.playerId === playerId &&
        event.kind.resource === "wood" &&
        event.kind.amount === 1 &&
        event.kind.total >= 1,
    ),
    ore: events.find(
      (event) =>
        event.kind?.type === "resourceGathered" &&
        event.kind.playerId === playerId &&
        event.kind.objectId === "east-ore" &&
        event.kind.resource === "ore" &&
        event.kind.amount === 1 &&
        event.kind.total >= 1,
    ),
    craft: events.find(
      (event) =>
        event.kind?.type === "itemCrafted" &&
        event.kind.playerId === playerId &&
        event.kind.objectId === "field-forge" &&
        event.kind.itemId === "trail-kit" &&
        event.kind.amount === 1 &&
        event.kind.total >= 1,
    ),
  };
}

export function hasAllGameplayEvents(found) {
  return Boolean(found.wood && found.ore && found.craft);
}

export function eventsAreOrdered(found) {
  return (
    hasAllGameplayEvents(found) &&
    found.wood.sequence < found.ore.sequence &&
    found.ore.sequence < found.craft.sequence
  );
}

export function eventSequences(found) {
  return {
    wood: found.wood?.sequence ?? null,
    ore: found.ore?.sequence ?? null,
    craft: found.craft?.sequence ?? null,
  };
}
