import { randomBytes } from "node:crypto";
import net from "node:net";

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
  let playerId = null;

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("websocket welcome timed out"));
      }, 2500);
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
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
