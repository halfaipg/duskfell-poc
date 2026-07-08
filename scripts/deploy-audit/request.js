export async function fetchWithTimeout(context, path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.timeoutMs);
  try {
    return await fetch(new URL(path, context.baseUrl), {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function tokenHeaders(header, token) {
  return token ? { [header]: token, accept: "application/json" } : { accept: "application/json" };
}

export async function protectedEndpointStatus(context, name, path, header, token) {
  if (context.profile !== "shared-poc") {
    context.add(name, true, "skipped outside shared-poc profile");
    return null;
  }
  if (!token) {
    context.add(name, false, `${header} token required for shared-poc audit`);
    return null;
  }
  try {
    const response = await fetchWithTimeout(context, path);
    await response.arrayBuffer();
    context.add(name, response.status === 401, `missing-token status=${response.status}`);
    return response.status;
  } catch (err) {
    context.add(name, false, err.message);
    return null;
  }
}
