import { performance } from "node:perf_hooks";

export async function runClient({ index, url, durationMs, inputHz, connectTimeoutMs }) {
  const stats = {
    index,
    sessionIssued: false,
    sessionId: null,
    connected: false,
    welcome: false,
    playerId: null,
    identityMatched: false,
    snapshots: 0,
    bytes: 0,
    snapshotBytes: 0,
    errors: 0,
    closeCode: null,
    joinLatencyMs: null,
    firstTick: null,
    lastTick: null,
  };
  const startedAt = performance.now();
  let seq = 0;
  let inputTimer;
  let stopTimer;
  let connectTimer;

  const sessionUrl = new URL(url);
  const session = await issueSession(sessionUrl).catch(() => null);
  if (session?.sessionToken) {
    stats.sessionIssued = true;
    stats.sessionId = session.sessionId;
    sessionUrl.searchParams.set("session", session.sessionToken);
  }

  const ws = new WebSocket(sessionUrl);
  ws.binaryType = "arraybuffer";

  await new Promise((resolve) => {
    connectTimer = setTimeout(() => {
      stats.errors += 1;
      try {
        ws.close();
      } catch {
        // Closing a failed socket is best effort.
      }
      resolve();
    }, connectTimeoutMs);

    ws.addEventListener("open", () => {
      stats.connected = true;
      clearTimeout(connectTimer);
      inputTimer = setInterval(() => {
        seq += 1;
        const phase = (seq + index) % 40;
        sendJson(ws, {
          type: "input",
          seq,
          up: phase >= 10 && phase < 20,
          down: phase >= 30,
          left: phase >= 20 && phase < 30,
          right: phase < 10,
          interact: false,
        });
      }, 1000 / inputHz);
      stopTimer = setTimeout(() => ws.close(1000, "benchmark-complete"), durationMs);
    });

    ws.addEventListener("message", (event) => {
      const text = String(event.data);
      stats.bytes += Buffer.byteLength(text);
      try {
        const message = JSON.parse(text);
        if (message.type === "welcome") {
          stats.welcome = true;
          stats.playerId = message.playerId;
          stats.identityMatched = !stats.sessionId || stats.playerId === stats.sessionId;
          stats.joinLatencyMs = performance.now() - startedAt;
          stats.firstTick = message.snapshot?.tick ?? null;
        } else if (message.type === "snapshot") {
          stats.snapshots += 1;
          stats.snapshotBytes += Buffer.byteLength(text);
          stats.lastTick = message.tick ?? stats.lastTick;
        }
      } catch {
        stats.errors += 1;
      }
    });

    ws.addEventListener("error", () => {
      stats.errors += 1;
    });

    ws.addEventListener("close", (event) => {
      clearTimeout(connectTimer);
      clearInterval(inputTimer);
      clearTimeout(stopTimer);
      stats.closeCode = event.code;
      resolve();
    });
  });

  return stats;
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function issueSession(wsUrl) {
  const sessionUrl = new URL("/api/session", wsUrl);
  sessionUrl.protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
  const response = await fetch(sessionUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) return null;
  return response.json();
}
