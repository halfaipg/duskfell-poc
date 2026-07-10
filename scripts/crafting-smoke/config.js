export const FALLBACK_TARGETS = {
  "north-grove": { id: "north-grove", x: 2112, y: 1216 },
  "ancient-ironleaf-tree": { id: "ancient-ironleaf-tree", x: 745, y: 640 },
  "east-ore": { id: "east-ore", x: 4928, y: 2432 },
  "field-forge": { id: "field-forge", x: 3328, y: 2176 },
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
