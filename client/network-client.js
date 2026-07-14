import { parseServerMessage } from "./server-messages.js";

export function createNetworkClient({
  getRequestedName,
  getInputState,
  setConnection,
  onWelcome,
  onSnapshot,
  onServerStateChange,
}) {
  let socket = null;
  let inputSeq = 0;
  let lastInputSent = "";

  async function connect() {
    setConnection("Connecting", "offline");
    const session = await issueSession(getRequestedName());
    if (!session) {
      setConnection("Session failed", "offline");
      setTimeout(connect, 1400);
      return;
    }

    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = new URL(`${scheme}://${window.location.host}/ws`);
    wsUrl.searchParams.set("session", session.sessionToken);
    socket = new WebSocket(wsUrl);
    socket.binaryType = "arraybuffer";

    socket.addEventListener("open", () => {
      setConnection("Online", "online");
      sendInput(true);
    });

    socket.addEventListener("close", () => {
      setConnection("Reconnecting", "offline");
      setTimeout(connect, 900);
    });

    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = parseServerMessage(event.data);
      } catch {
        return;
      }
      if (message.type === "welcome") {
        onWelcome(message);
      } else if (message.type === "snapshot") {
        onSnapshot(message);
      }
      onServerStateChange();
    });
  }

  // server ingress allows ~30 msgs/s (burst 20) and kicks after 8 rejects;
  // throttle to well under that with a trailing send so the final state
  // always lands. Click-to-move re-evaluates every frame and used to flood.
  const INPUT_MIN_INTERVAL_MS = 70;
  let lastInputSentAt = 0;
  let trailingInputTimer = null;

  function sendInput(force = false) {
    const state = getInputState();
    const input = {
      type: "input",
      seq: 0,
      up: Boolean(state.up),
      down: Boolean(state.down),
      left: Boolean(state.left),
      right: Boolean(state.right),
      interact: Boolean(state.interact),
    };
    const comparable = JSON.stringify(input);
    if (!force && comparable === lastInputSent) return;
    const now = Date.now();
    const wait = lastInputSentAt + INPUT_MIN_INTERVAL_MS - now;
    if (!force && wait > 0) {
      if (!trailingInputTimer) {
        trailingInputTimer = setTimeout(() => {
          trailingInputTimer = null;
          sendInput();
        }, wait);
      }
      return;
    }
    lastInputSent = comparable;
    lastInputSentAt = now;
    input.seq = ++inputSeq;
    send(input);
  }

  function send(payload) {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }

  return {
    connect,
    send,
    sendInput,
  };
}

async function issueSession(requestedName) {
  try {
    const name = typeof requestedName === "string" ? requestedName.trim() : "";
    const body = name ? { name } : {};
    const response = await fetch("/api/session", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
