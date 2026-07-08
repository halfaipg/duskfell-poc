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
