export async function fetchStatus(context, endpoint, options = {}) {
  const response = await fetch(`${context.httpUrl}${endpoint}`, options);
  await response.arrayBuffer();
  return response.status;
}

export async function fetchText(context, endpoint, options = {}) {
  const response = await fetch(`${context.httpUrl}${endpoint}`, options);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.text();
}

export async function fetchJson(context, endpoint, options = {}) {
  const response = await fetch(`${context.httpUrl}${endpoint}`, options);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.json();
}

export function parseMetric(text, name) {
  const match = text.match(new RegExp(`^${name} ([0-9]+)$`, "m"));
  return match ? Number(match[1]) : Number.NaN;
}
