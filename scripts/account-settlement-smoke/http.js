export async function issueSession(context, jwt) {
  const response = await fetch(`${context.httpUrl}/api/session`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Bound_7" }),
  });
  if (!response.ok) {
    throw new Error(`/api/session returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

export async function fetchAdminJson(context, endpoint) {
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
