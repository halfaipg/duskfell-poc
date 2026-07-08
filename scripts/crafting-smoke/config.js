export const FALLBACK_TARGETS = {
  "north-grove": { id: "north-grove", x: 640, y: 520 },
  "ancient-ironleaf-tree": { id: "ancient-ironleaf-tree", x: 720, y: 520 },
  "east-ore": { id: "east-ore", x: 2705, y: 1445 },
  "field-forge": { id: "field-forge", x: 1904, y: 1184 },
};

export function createCraftingContext(rawArgs) {
  const args = parseArgs(rawArgs);
  const url = args.url ?? "ws://127.0.0.1:4107/ws";
  const timeoutMs = Number(args.timeoutMs ?? 60000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--timeoutMs must be positive");
  }
  return {
    url,
    wsUrl: new URL(url),
    timeoutMs,
  };
}

export function round(value) {
  return Math.round(value * 100) / 100;
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    parsed[key] = inlineValue ?? rawArgs[index + 1];
    if (inlineValue == null) index += 1;
  }
  return parsed;
}
