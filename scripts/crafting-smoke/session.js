import { FALLBACK_TARGETS } from "./config.js";

export async function issueSession(wsUrl) {
  const response = await fetch(httpUrlFor(wsUrl, "/api/session"), {
    method: "POST",
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`session issue failed: ${response.status}`);
  }
  return response.json();
}

export async function loadDemoTargets(wsUrl) {
  try {
    const response = await fetch(httpUrlFor(wsUrl, "/api/snapshot"), {
      headers: {
        accept: "application/json",
      },
    });
    if (!response.ok) return FALLBACK_TARGETS;
    const snapshot = await response.json();
    return Object.fromEntries(
      Object.keys(FALLBACK_TARGETS).map((id) => {
        const object = snapshot.objects?.find((candidate) => candidate.id === id);
        return [id, object ? { id: object.id, x: object.x, y: object.y } : FALLBACK_TARGETS[id]];
      }),
    );
  } catch {
    return FALLBACK_TARGETS;
  }
}

export function sessionWebSocketUrl(wsUrl, sessionToken) {
  const socketUrl = new URL(wsUrl);
  socketUrl.searchParams.set("session", sessionToken);
  return socketUrl;
}

function httpUrlFor(wsUrl, path) {
  const url = new URL(path, wsUrl);
  url.protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
  return url;
}
