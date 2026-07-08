import { performance } from "node:perf_hooks";

export async function waitForMetric(context, name, expected) {
  const deadline = performance.now() + 2500;
  while (performance.now() < deadline) {
    const metrics = parseMetrics(await fetchText(context, "/metrics"), [name]);
    if (metrics[name] === expected) {
      return;
    }
    await sleep(80);
  }
  throw new Error(`timed out waiting for ${name}=${expected}`);
}

export async function fetchText(context, pathname) {
  const response = await fetch(`${context.httpUrl}${pathname}`);
  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}: ${await response.text()}`);
  }
  return response.text();
}

export function parseMetrics(text, names) {
  const metrics = {};
  for (const name of names) {
    const match = text.match(new RegExp(`^${name} ([-0-9.]+)$`, "m"));
    metrics[name] = match ? Number(match[1]) : Number.NaN;
  }
  return metrics;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
