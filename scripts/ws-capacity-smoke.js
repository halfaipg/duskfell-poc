const url = process.argv[2] ?? "ws://127.0.0.1:4107/ws";

const missingSession = await connectAndObserve(url, 500, { issueSession: false });
const first = await connectAndHold(url);
if (!first.welcomed) {
  console.error(JSON.stringify({ error: "first client was not welcomed", first }, null, 2));
  process.exit(1);
}

const second = await connectAndObserve(url, 900);
const metrics = parseMetrics(await fetchMetrics(url), [
  "sundermere_session_ticket_rejected_total",
  "sundermere_ws_capacity_rejected_total",
]);
first.close();

console.log(
  JSON.stringify(
    {
      url,
      missingSessionWelcomed: missingSession.welcomed,
      missingSessionClosed: missingSession.closed,
      firstWelcomed: first.welcomed,
      secondWelcomed: second.welcomed,
      secondClosed: second.closed,
      secondCloseCode: second.closeCode,
      metrics,
    },
    null,
    2,
  ),
);

if (
  missingSession.welcomed ||
  !missingSession.closed ||
  second.welcomed ||
  metrics.sundermere_session_ticket_rejected_total !== 1 ||
  metrics.sundermere_ws_capacity_rejected_total !== 1
) {
  process.exitCode = 1;
}

async function connectAndHold(rawUrl) {
  const sessionUrl = await ticketedUrl(rawUrl);
  const ws = new WebSocket(sessionUrl);
  let welcomed = false;

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome") {
        welcomed = true;
        clearTimeout(timer);
        resolve();
      }
    });
    ws.addEventListener("error", resolve);
    ws.addEventListener("close", resolve);
  });

  return {
    welcomed,
    close: () => {
      try {
        ws.close(1000, "capacity-smoke-complete");
      } catch {
        // Best effort.
      }
    },
  };
}

async function connectAndObserve(rawUrl, durationMs, options = {}) {
  const sessionUrl = options.issueSession === false ? new URL(rawUrl) : await ticketedUrl(rawUrl);
  const ws = new WebSocket(sessionUrl);
  let welcomed = false;
  let closed = false;
  let closeCode = null;

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        ws.close(1000, "capacity-smoke-timeout");
      } catch {
        // Best effort.
      }
      resolve();
    }, durationMs);
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome") {
        welcomed = true;
      }
    });
    ws.addEventListener("close", (event) => {
      closed = true;
      closeCode = event.code;
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      resolve();
    });
  });

  return {
    welcomed,
    closed,
    closeCode,
  };
}

async function fetchMetrics(rawUrl) {
  const wsUrl = new URL(rawUrl);
  const metricsUrl = new URL("/metrics", wsUrl);
  metricsUrl.protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
  const response = await fetch(metricsUrl);
  if (!response.ok) {
    throw new Error(`/metrics returned ${response.status}`);
  }
  return response.text();
}

function parseMetrics(text, names) {
  const metrics = {};
  for (const name of names) {
    const match = text.match(new RegExp(`^${name} ([0-9]+)$`, "m"));
    metrics[name] = match ? Number(match[1]) : Number.NaN;
  }
  return metrics;
}

async function ticketedUrl(rawUrl) {
  const wsUrl = new URL(rawUrl);
  const sessionUrl = new URL("/api/session", wsUrl);
  sessionUrl.protocol = wsUrl.protocol === "wss:" ? "https:" : "http:";
  const response = await fetch(sessionUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`session issue failed: ${response.status}`);
  }
  const session = await response.json();
  wsUrl.searchParams.set("session", session.sessionToken);
  return wsUrl;
}
