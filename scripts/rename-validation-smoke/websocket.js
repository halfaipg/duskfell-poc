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
export async function runRenameFlow(context, sessionToken, expectedPlayerId) {
  const url = new URL(context.wsUrl);
  url.searchParams.set("session", sessionToken);
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  let playerId = null;
  let spawnNameObserved = false;
  let validRenameObserved = false;
  let invalidRenameSent = false;
  let invalidRenamePreservedName = false;
  let snapshotsAfterInvalid = 0;

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("rename validation smoke timed out"));
      }, context.timeoutMs);

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "rename", name: context.validName }));
      });

      socket.addEventListener("message", (event) => {
        const message = decodeServerFrame(event.data);
        if (message.type === "welcome") {
          playerId = message.playerId;
          const me = message.snapshot.players.find((player) => player.id === playerId);
          spawnNameObserved = me?.name === context.spawnName;
          return;
        }
        if (message.type !== "snapshot" || !playerId) return;

        const me = message.players.find((player) => player.id === playerId);
        if (!me) return;

        if (!validRenameObserved && me.name === context.validName) {
          validRenameObserved = true;
          socket.send(JSON.stringify({ type: "rename", name: context.invalidName }));
          invalidRenameSent = true;
          return;
        }

        if (invalidRenameSent) {
          snapshotsAfterInvalid += 1;
          if (me.name === context.validName) {
            invalidRenamePreservedName = true;
          }
          if (snapshotsAfterInvalid >= 2) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });

      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("websocket error"));
      });
      socket.addEventListener("close", () => {
        clearTimeout(timeout);
        reject(new Error("websocket closed before rename validation completed"));
      });
    });
  } catch (err) {
    closeSocket(socket);
    throw err;
  }

  return {
    sessionId: expectedPlayerId,
    playerId,
    identityMatched: playerId === expectedPlayerId,
    spawnNameObserved,
    validRenameObserved,
    invalidRenamePreservedName,
    close() {
      closeSocket(socket);
    },
  };
}

function closeSocket(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.close(1000, "rename-validation-smoke-complete");
  }
}
