export async function issueSession(context, options = {}) {
  const headers = {
    accept: "application/json",
  };
  if (options.authorization) {
    headers.authorization = options.authorization;
  }
  if (options.contentType) {
    headers["content-type"] = options.contentType;
  }
  const response = await fetch(`${context.httpUrl}/api/session`, {
    method: "POST",
    headers,
    body: options.body,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: parseMaybeJson(text) ?? text,
  };
}

export async function fetchJson(context, endpoint) {
  const response = await fetch(`${context.httpUrl}${endpoint}`);
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

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
