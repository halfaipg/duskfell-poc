import { randomBytes } from "node:crypto";
import net from "node:net";
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

export async function issueSession(context) {
  const response = await fetch(`${context.httpUrl}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`/api/session returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

export async function connectAndHold(context, sessionToken) {
  const url = new URL(context.wsUrl);
  url.searchParams.set("session", sessionToken);
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  let playerId = null;

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("websocket welcome timed out"));
      }, 2500);
      socket.addEventListener("message", (event) => {
        const message = decodeServerFrame(event.data);
        if (message.type === "welcome") {
          playerId = message.playerId;
          clearTimeout(timeout);
          resolve();
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("websocket errored before welcome"));
      });
      socket.addEventListener("close", () => {
        if (!playerId) {
          clearTimeout(timeout);
          reject(new Error("websocket closed before welcome"));
        }
      });
    });
  } catch (err) {
    closeHeldSocket(socket, "ws-admission-preflight-smoke-cleanup");
    throw err;
  }

  socket.playerId = playerId;
  return socket;
}

export async function rawWebSocketHandshake(context, sessionToken) {
  const url = new URL(context.wsUrl);
  if (sessionToken) {
    url.searchParams.set("session", sessionToken);
  }
  const key = randomBytes(16).toString("base64");
  const pathAndQuery = `${url.pathname}${url.search}`;
  const request = [
    `GET ${pathAndQuery} HTTP/1.1`,
    `Host: ${url.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "",
    "",
  ].join("\r\n");

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: url.hostname, port: Number(url.port) });
    let data = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("raw websocket handshake timed out"));
    }, 2000);

    socket.on("connect", () => {
      socket.write(request);
    });
    socket.on("data", (chunk) => {
      data += String(chunk);
      if (data.includes("\r\n\r\n")) {
        clearTimeout(timeout);
        socket.destroy();
        resolve({
          statusLine: data.split("\r\n")[0],
          raw: data,
        });
      }
    });
    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    socket.on("close", () => {
      if (!data) {
        clearTimeout(timeout);
        reject(new Error("raw websocket handshake closed without response"));
      }
    });
  });
}

export function closeHeldSocket(socket, reason) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.close(1000, reason);
  }
}
