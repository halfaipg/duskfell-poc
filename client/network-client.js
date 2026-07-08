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

  function sendInput(force = false) {
    const state = getInputState();
    const input = {
      type: "input",
      seq: ++inputSeq,
      up: Boolean(state.up),
      down: Boolean(state.down),
      left: Boolean(state.left),
      right: Boolean(state.right),
      interact: Boolean(state.interact),
    };
    const comparable = JSON.stringify({ ...input, seq: 0 });
    if (!force && comparable === lastInputSent) return;
    lastInputSent = comparable;
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
