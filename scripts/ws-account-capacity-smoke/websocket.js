import { randomBytes } from "node:crypto";
import net from "node:net";

import { issueSession } from "./http.js";

export async function connectAndHoldAccountSocket(context, jwt) {
  const session = await issueSession(context, jwt);
  const socketUrl = new URL(context.wsUrl);
  socketUrl.searchParams.set("session", session.sessionToken);
  const socket = new WebSocket(socketUrl);
  let welcomed = false;
  let playerId = null;
  let accountSubject = null;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("first websocket welcome timed out")), 5000);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome") {
        welcomed = true;
        playerId = message.playerId;
        accountSubject =
          message.snapshot?.players?.find((player) => player.id === message.playerId)
            ?.accountSubject ?? null;
        clearTimeout(timer);
        resolve();
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("first websocket failed"));
    });
    socket.addEventListener("close", () => {
      if (!welcomed) {
        clearTimeout(timer);
        reject(new Error("first websocket closed before welcome"));
      }
    });
  });

  return {
    welcomed,
    playerId,
    accountSubject,
    identityMatched: playerId === session.sessionId,
    close: () => {
      try {
        socket.close(1000, "ws-account-capacity-smoke-complete");
      } catch {
        // Best effort.
      }
    },
  };
}

export async function connectAndObserveAccountCapacityRejection(context, jwt, durationMs) {
  const session = await issueSession(context, jwt);
  const handshake = await rawWebSocketHandshake(context, session.sessionToken, durationMs);

  return {
    sessionId: session.sessionId,
    statusLine: handshake.statusLine,
    body: handshake.body.trim(),
    rejectedBeforeUpgrade: !handshake.statusLine.includes("101 Switching Protocols"),
  };
}

async function rawWebSocketHandshake(context, sessionToken, timeoutMs) {
  const socketUrl = new URL(context.wsUrl);
  socketUrl.searchParams.set("session", sessionToken);
  const key = randomBytes(16).toString("base64");
  const request = [
    `GET ${socketUrl.pathname}${socketUrl.search} HTTP/1.1`,
    `Host: ${socketUrl.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "",
    "",
  ].join("\r\n");

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: socketUrl.hostname, port: context.port });
    let data = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("second websocket handshake timed out"));
    }, timeoutMs);

    socket.on("connect", () => {
      socket.write(request);
    });
    socket.on("data", (chunk) => {
      data += String(chunk);
      if (data.includes("\r\n\r\n")) {
        clearTimeout(timer);
        socket.destroy();
        resolve(parseHttpResponse(data));
      }
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on("close", () => {
      if (!data) {
        clearTimeout(timer);
        reject(new Error("second websocket handshake closed without response"));
      }
    });
  });
}

function parseHttpResponse(response) {
  const [head, body = ""] = response.split("\r\n\r\n", 2);
  const [statusLine = ""] = head.split("\r\n");
  return {
    statusLine,
    statusCode: Number(statusLine.split(" ")[1]),
    body,
  };
}
