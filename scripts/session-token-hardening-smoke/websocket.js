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

export async function requestWebSocketUpgrade(context, sessionToken) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: context.port });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error("timed out waiting for session-ticket upgrade rejection"));
    }, 5000);
    let response = "";

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      const requestPath = `/ws?session=${encodeURIComponent(sessionToken)}`;
      socket.write(
        [
          `GET ${requestPath} HTTP/1.1`,
          `Host: 127.0.0.1:${context.port}`,
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );
    });
    socket.on("data", (chunk) => {
      response += chunk;
      const parsed = parseCompleteHttpResponse(response);
      if (parsed) {
        settled = true;
        clearTimeout(timeout);
        socket.end();
        resolve(parsed);
      }
    });
    socket.on("end", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(parseHttpResponse(response));
    });
    socket.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export async function connectWithTicket(context, sessionToken, sessionId) {
  return new Promise((resolve, reject) => {
    const url = new URL(context.wsUrl);
    url.searchParams.set("session", sessionToken);
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    const timeout = setTimeout(() => {
      socket.close(1000, "session-token-hardening-timeout");
      reject(new Error("timed out waiting for welcome"));
    }, 5000);

    socket.addEventListener("message", (event) => {
      const message = decodeServerFrame(event.data);
      if (message.type !== "welcome") {
        return;
      }
      clearTimeout(timeout);
      socket.close(1000, "session-token-hardening-complete");
      resolve({
        welcomeReceived: true,
        playerId: message.playerId,
        identityMatched: message.playerId === sessionId,
      });
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("websocket failed before welcome"));
    });
  });
}

function parseHttpResponse(response) {
  const [head, body = ""] = response.split("\r\n\r\n", 2);
  const [statusLine = ""] = head.split("\r\n");
  const statusCode = Number(statusLine.split(" ")[1]);
  return {
    statusLine,
    statusCode,
    body,
  };
}

function parseCompleteHttpResponse(response) {
  const separatorIndex = response.indexOf("\r\n\r\n");
  if (separatorIndex === -1) return null;

  const head = response.slice(0, separatorIndex);
  const body = response.slice(separatorIndex + 4);
  const lines = head.split("\r\n");
  const [statusLine = ""] = lines;
  const contentLengthLine = lines.find((line) =>
    line.toLowerCase().startsWith("content-length:"),
  );
  const contentLength = contentLengthLine
    ? Number(contentLengthLine.slice("content-length:".length).trim())
    : 0;
  if (!Number.isFinite(contentLength) || body.length < contentLength) {
    return null;
  }

  return {
    statusLine,
    statusCode: Number(statusLine.split(" ")[1]),
    body: body.slice(0, contentLength),
  };
}
