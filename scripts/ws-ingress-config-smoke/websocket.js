import { issueSession } from "./http.js";

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
  let playerId = null;

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("websocket welcome timed out")), 5000);
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
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
