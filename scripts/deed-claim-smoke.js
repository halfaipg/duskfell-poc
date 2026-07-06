import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const url = args.url ?? "ws://127.0.0.1:4107/ws";
const timeoutMs = Number(args.timeoutMs ?? 8000);

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
let claimedDeed = null;
let confirmedReceipt = null;
let closed = false;
let error = null;

try {
  socket = new WebSocket(wsUrl);
  await runSmoke();
} catch (err) {
  error = err;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.close(1000, "deed-claim-smoke-complete");
  }
}

const elapsedMs = performance.now() - startedAt;
const result = {
  url,
  sessionId: session.sessionId,
  playerId,
  identityMatched: session.sessionId === playerId,
  claimedDeed,
  confirmedReceipt,
  settlement: latestSnapshot?.settlement ?? null,
  elapsedMs: round(elapsedMs),
  closed,
  error: error?.message ?? null,
};

console.log(JSON.stringify(result, null, 2));

if (
  error ||
  !result.identityMatched ||
  !claimedDeed ||
  !confirmedReceipt ||
  confirmedReceipt.assetId !== claimedDeed
) {
  process.exitCode = 1;
}

async function runSmoke() {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("deed claim smoke timed out"));
    }, timeoutMs);

    socket.addEventListener("open", () => {
      sendInput({ right: false });
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
      const registrar = latestSnapshot.objects.find((object) => object.id === "registrar");
      if (!me || !registrar) return;

      const deed = me.demoDeeds.find((assetId) => assetId.startsWith("dryrun-deed-"));
      if (deed) {
        claimedDeed = deed;
        sendInput({});
      } else {
        steerToward(me, registrar);
      }

      const receipt = latestSnapshot.settlement.latestReceipt;
      if (claimedDeed && receipt?.assetId === claimedDeed) {
        confirmedReceipt = receipt;
        clearTimeout(timeout);
        resolve();
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
