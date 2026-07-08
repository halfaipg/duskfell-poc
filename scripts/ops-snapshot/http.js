export async function fetchJson(context, endpoint, options) {
  const response = await fetchWithTimeout(context, endpoint, options);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return { status: response.status, body };
}

export async function fetchText(context, endpoint, options) {
  const response = await fetchWithTimeout(context, endpoint, options);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return { status: response.status, body };
}

export function adminHeaders(context) {
  return tokenHeaders("x-admin-token", context.adminToken, "application/json");
}

export function metricsHeaders(context, accept) {
  return tokenHeaders("x-metrics-token", context.metricsToken, accept);
}

async function fetchWithTimeout(context, pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.timeoutMs);
  try {
    return await fetch(new URL(pathname, context.baseUrl), {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function tokenHeaders(header, token, accept) {
  return token ? { [header]: token, accept } : { accept };
}
