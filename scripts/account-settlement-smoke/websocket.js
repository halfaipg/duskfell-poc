import { decodeMsgpack } from "../../client/msgpack-decode.js";

function decodeServerFrame(data) {
  if (data instanceof ArrayBuffer) return hydrateUuids(decodeMsgpack(new Uint8Array(data)));
  if (ArrayBuffer.isView(data)) {
    return hydrateUuids(decodeMsgpack(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
  }
  return JSON.parse(String(data));
}

// MessagePack frames carry UUIDs as 16 raw bytes; smokes compare ids as
// strings, so format them like the JSON protocol did.
function hydrateUuids(value) {
  if (value instanceof Uint8Array && value.byteLength === 16) {
    const hex = [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  if (Array.isArray(value)) return value.map(hydrateUuids);
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    for (const key of Object.keys(value)) {
      value[key] = hydrateUuids(value[key]);
    }
  }
  return value;
}
export async function claimDeed(context, sessionToken) {
  const url = new URL(context.wsUrl);
  url.searchParams.set("session", sessionToken);
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  let seq = 0;
  let playerId = null;
  let snapshotAccountSubject = null;
  let claimedDeed = null;
  let confirmedReceipt = null;

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("account settlement smoke timed out")),
        8000,
      );

      socket.addEventListener("open", () => sendInput({}));
      socket.addEventListener("message", (event) => {
        const message = decodeServerFrame(event.data);
        const snapshot = message.type === "welcome" ? message.snapshot : message;
        if (message.type === "welcome") {
          playerId = message.playerId;
        }
        if (!snapshot?.players || !playerId) return;

        const me = snapshot.players.find((player) => player.id === playerId);
        const registrar = snapshot.objects.find((object) => object.id === "registrar");
        if (!me || !registrar) return;
        snapshotAccountSubject = me.accountSubject ?? null;

        const deed = me.demoDeeds.find((assetId) => assetId.startsWith("dryrun-deed-"));
        if (deed) {
          claimedDeed = deed;
          sendInput({});
        } else {
          steerToward(me, registrar, sendInput);
        }

        const receipt = snapshot.settlement.latestReceipt;
        if (claimedDeed && receipt?.assetId === claimedDeed) {
          confirmedReceipt = receipt;
          clearTimeout(timeout);
          resolve();
        }
      });
      socket.addEventListener("close", () => {
        if (!confirmedReceipt) {
          clearTimeout(timeout);
          reject(new Error("websocket closed before account-bound receipt"));
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("websocket error"));
      });
    });
  } catch (err) {
    closeSocket(socket);
    throw err;
  }

  return {
    playerId,
    snapshotAccountSubject,
    claimedDeed,
    confirmedReceipt,
    close() {
      closeSocket(socket);
    },
  };

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
}

function closeSocket(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.close(1000, "account-settlement-smoke-complete");
  }
}

function steerToward(me, target, sendInput) {
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
