export async function hasResourceJournalEvent(wsUrl, expectedPlayerId, expectedObjectId) {
  const eventsUrl = httpUrlFor(wsUrl, "/admin/events?limit=20");
  const response = await fetch(eventsUrl, {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) return false;
  const events = await response.json();
  return events.some(
    (event) =>
      event.kind?.type === "resourceGathered" &&
      event.kind.playerId === expectedPlayerId &&
      event.kind.objectId === expectedObjectId &&
      event.kind.resource === "wood" &&
      event.kind.amount === 1 &&
      event.kind.total >= 1,
  );
}

function httpUrlFor(wsUrl, path) {
  const url = new URL(path, wsUrl);
  url.protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
  return url;
}
