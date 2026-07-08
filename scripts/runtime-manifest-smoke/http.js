export async function fetchStatus(context, endpoint, token) {
  const headers = {};
  if (token) {
    headers["x-admin-token"] = token;
  }
  const response = await fetch(`${context.httpUrl}${endpoint}`, { headers });
  await response.arrayBuffer();
  return response.status;
}

export async function fetchJson(context, endpoint, token) {
  const headers = {};
  if (token) {
    headers["x-admin-token"] = token;
  }
  const response = await fetch(`${context.httpUrl}${endpoint}`, { headers });
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.json();
}
