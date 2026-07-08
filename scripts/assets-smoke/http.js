export async function fetchJson(context, endpoint) {
  const response = await fetch(`${context.httpUrl}${endpoint}`);
  return {
    response,
    body: await response.json(),
  };
}

export async function fetchBuffer(context, endpoint) {
  const response = await fetch(`${context.httpUrl}${endpoint}`);
  return {
    response,
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}
