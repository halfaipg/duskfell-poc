import { issueSession } from "./http.js";
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

export async function sendOversizedFrame(context) {
  const { socket, session, playerId } = await connectWithSession(context);
  const payload = JSON.stringify({ type: "rename", name: "A".repeat(160) });
  socket.send(payload);
  await sleep(250);
  socket.close(1000, "ws-ingress-config-oversized-complete");
  await waitForClose(socket);

  return {
    sessionId: session.sessionId,
    playerId,
    identityMatched: playerId === session.sessionId,
    bytes: Buffer.byteLength(payload),
  };
}

export async function sendBurstUntilClose(context) {
  const { socket, session, playerId } = await connectWithSession(context);
  for (let index = 0; index < context.wsMessageBurst + context.clientRejectLimit; index += 1) {
    socket.send(JSON.stringify({ type: "rename", name: `R_${index}` }));
  }
  const closed = await waitForClose(socket, 5000);

  return {
    sessionId: session.sessionId,
    playerId,
    identityMatched: playerId === session.sessionId,
    sentMessages: context.wsMessageBurst + context.clientRejectLimit,
    closed,
  };
}

async function connectWithSession(context) {
  const session = await issueSession(context);
  const socketUrl = new URL(context.wsUrl);
  socketUrl.searchParams.set("session", session.sessionToken);
  const socket = new WebSocket(socketUrl);
  socket.binaryType = "arraybuffer";
  let playerId = null;

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("websocket welcome timed out")), 5000);
      socket.addEventListener("message", (event) => {
        const message = decodeServerFrame(event.data);
        if (message.type === "welcome") {
          playerId = message.playerId;
          clearTimeout(timer);
          resolve();
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("websocket failed"));
      });
      socket.addEventListener("close", () => {
        clearTimeout(timer);
        reject(new Error("websocket closed before welcome"));
      });
    });
  } catch (err) {
    closeSocket(socket);
    throw err;
  }

  return { socket, session, playerId };
}

async function waitForClose(socket, timeoutMs = 1000) {
  if (socket.readyState === WebSocket.CLOSED) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(socket.readyState === WebSocket.CLOSED), timeoutMs);
    socket.addEventListener("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function closeSocket(socket) {
  try {
    socket.close(1000, "ws-ingress-config-smoke-complete");
  } catch {
    // Best effort.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
