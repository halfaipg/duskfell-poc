import { performance } from "node:perf_hooks";

export async function issueSession(context) {
  const response = await fetch(`${context.httpUrl}/api/session`, {
    method: "POST",
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`/api/session returned ${response.status}`);
  }
  return response.json();
}

export async function waitForRejectedMessages(context, minimum) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const metrics = parseMetrics(await fetchText(context, "/metrics"), [
      "sundermere_ws_messages_rejected_total",
    ]);
    if (metrics.sundermere_ws_messages_rejected_total >= minimum) {
      return metrics;
    }
    await sleep(120);
  }
  throw new Error(`rejected message count did not reach ${minimum}`);
}

export async function fetchJson(context, endpoint) {
  const response = await fetch(`${context.httpUrl}${endpoint}`, {
    headers: {
      "x-admin-token": context.adminToken,
    },
  });
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.json();
}

export async function fetchText(context, endpoint) {
  const response = await fetch(`${context.httpUrl}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.text();
}

export function parseMetrics(text, names) {
  const metrics = {};
  for (const name of names) {
    const match = text.match(new RegExp(`^${name} ([0-9]+)$`, "m"));
    metrics[name] = match ? Number(match[1]) : Number.NaN;
  }
  return metrics;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
