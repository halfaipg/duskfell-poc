export async function issueSession(context) {
  const response = await fetch(`${context.httpUrl}/api/session`, {
    method: "POST",
    headers: {
      accept: "application/json",
    },
  });
  await response.arrayBuffer();
  return {
    status: response.status,
  };
}

export async function fetchText(context, endpoint) {
  const response = await fetch(`${context.httpUrl}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  return response.text();
}
