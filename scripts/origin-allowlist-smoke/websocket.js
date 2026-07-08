import crypto from "node:crypto";
import net from "node:net";

export async function rawWebSocketHandshake(context, sessionToken, origin) {
  const socket = new net.Socket();

  await new Promise((resolve, reject) => {
    function onConnect() {
      cleanup();
      resolve();
    }
    function onError(err) {
      cleanup();
      reject(err);
    }
    function cleanup() {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    }
    socket.once("connect", onConnect);
    socket.once("error", onError);
    socket.connect(context.port, "127.0.0.1");
  });

  const key = crypto.randomBytes(16).toString("base64");
  const request = [
    `GET /ws?session=${encodeURIComponent(sessionToken)} HTTP/1.1`,
    `Host: 127.0.0.1:${context.port}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    origin ? `Origin: ${origin}` : null,
    "\r\n",
  ]
    .filter((line) => line !== null)
    .join("\r\n");
  socket.write(request);

  const headers = await readUpgradeHeaders(socket);
  socket.destroy();
  return {
    statusLine: headers.split("\r\n")[0] ?? "",
  };
}

async function readUpgradeHeaders(socket) {
  let buffer = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("websocket upgrade timed out"));
    }, 3000);
    function onData(chunk) {
      buffer += chunk.toString("binary");
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        cleanup();
        resolve(buffer.slice(0, headerEnd));
      }
    }
    function onError(err) {
      cleanup();
      reject(err);
    }
    function cleanup() {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    }
    socket.on("data", onData);
    socket.on("error", onError);
  });
}
