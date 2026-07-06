import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const url = args.url ?? "ws://127.0.0.1:4107/ws";
const timeoutMs = Number(args.timeoutMs ?? 10000);

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error("--timeoutMs must be positive");
}

const startedAt = performance.now();
const session = await issueSession(new URL(url));
const wsUrl = new URL(url);
wsUrl.searchParams.set("session", session.sessionToken);

let socket;
let seq = 0;
let playerId = null;
let latestSnapshot = null;
let gathered = null;
let journaled = false;
let closed = false;
let error = null;

try {
  socket = new WebSocket(wsUrl);
  await runSmoke();
  journaled = await hasResourceJournalEvent(new URL(url), playerId, gathered?.objectId);
} catch (err) {
  error = err;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.close(1000, "resource-gather-smoke-complete");
  }
}

const elapsedMs = performance.now() - startedAt;
const result = {
  url,
  sessionId: session.sessionId,
  playerId,
  identityMatched: session.sessionId === playerId,
  gathered,
  journaled,
  elapsedMs: round(elapsedMs),
  closed,
  error: error?.message ?? null,
};

console.log(JSON.stringify(result, null, 2));

if (
  error ||
  !result.identityMatched ||
  !gathered ||
  !hasWoodStack(gathered) ||
  !journaled
) {
  process.exitCode = 1;
}

function hasWoodStack(gathered) {
  return (
    gathered.capacitySlots >= 1 &&
    gathered.items.some(
      (item) => item.itemId === "wood" && item.label === "Wood" && item.quantity >= 1,
    )
  );
}

async function runSmoke() {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("resource gather smoke timed out"));
    }, timeoutMs);

    socket.addEventListener("open", () => {
      sendInput({});
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome") {
        playerId = message.playerId;
        latestSnapshot = message.snapshot;
      } else if (message.type === "snapshot") {
        latestSnapshot = message;
      }

      if (!latestSnapshot || !playerId) return;
      const me = latestSnapshot.players.find((player) => player.id === playerId);
      const grove = latestSnapshot.objects.find((object) => object.id === "north-grove");
      if (!me || !grove) return;

      if (me.resources?.wood > 0) {
        gathered = {
          objectId: grove.id,
          wood: me.resources.wood,
          ore: me.resources.ore,
          capacitySlots: me.inventory?.capacitySlots,
          items: me.inventory?.items ?? [],
        };
        sendInput({});
        clearTimeout(timeout);
        resolve();
      } else {
        steerToward(me, grove);
      }
    });

    socket.addEventListener("close", () => {
      closed = true;
    });

    socket.addEventListener("error", () => {
      reject(new Error("websocket error"));
    });
  });
}

function steerToward(me, target) {
  const dx = target.x - me.x;
  const dy = target.y - me.y;
  const distance = Math.hypot(dx, dy);
  const interact = distance <= 58;
  sendInput({
    up: dy < -8 && !interact,
    down: dy > 8 && !interact,
    left: dx < -8 && !interact,
    right: dx > 8 && !interact,
    interact,
  });
}

function sendInput(input) {
  if (socket.readyState !== WebSocket.OPEN) return;
  seq += 1;
  socket.send(
    JSON.stringify({
      type: "input",
      seq,
      up: Boolean(input.up),
      down: Boolean(input.down),
      left: Boolean(input.left),
      right: Boolean(input.right),
      interact: Boolean(input.interact),
    }),
  );
}

async function hasResourceJournalEvent(wsUrl, expectedPlayerId, expectedObjectId) {
  const eventsUrl = new URL("/admin/events?limit=20", wsUrl);
  eventsUrl.protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
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

async function issueSession(wsUrl) {
  const sessionUrl = new URL("/api/session", wsUrl);
  sessionUrl.protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
  const response = await fetch(sessionUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`session issue failed: ${response.status}`);
  }
  return response.json();
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    parsed[key] = inlineValue ?? rawArgs[index + 1];
    if (inlineValue == null) index += 1;
  }
  return parsed;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
