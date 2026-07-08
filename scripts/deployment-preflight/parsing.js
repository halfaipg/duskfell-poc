import net from "node:net";

const PLACEHOLDER_SECRET_MARKERS = [
  "replace-with",
  "placeholder",
  "changeme",
  "change-me",
  "todo",
];

export function isCompactPrintable(value) {
  return typeof value === "string" && value.length > 0 && !/[\s\x00-\x1f\x7f]/u.test(value);
}

export function looksLikePlaceholderSecret(value) {
  const normalized = value.toLowerCase();
  return PLACEHOLDER_SECRET_MARKERS.some((marker) => normalized.includes(marker));
}

export function parseBindAddr(value) {
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, error: "BIND_ADDR must be a socket address" };
  }
  if (value.trim() !== value || /[\s\x00-\x1f\x7f]/u.test(value)) {
    return {
      ok: false,
      error: "BIND_ADDR must not contain whitespace or control characters",
    };
  }

  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close <= 1 || value[close + 1] !== ":") {
      return { ok: false, error: "BIND_ADDR IPv6 addresses must look like [::1]:4107" };
    }
    const host = value.slice(1, close);
    const port = value.slice(close + 2);
    if (net.isIP(host) !== 6) {
      return { ok: false, error: "BIND_ADDR bracketed host must be an IPv6 address" };
    }
    return parseBindPort(port, host);
  }

  const parts = value.split(":");
  if (parts.length !== 2 || parts[0].length === 0) {
    return {
      ok: false,
      error: "BIND_ADDR must be an IP socket address such as 127.0.0.1:4107 or [::1]:4107",
    };
  }
  if (net.isIP(parts[0]) !== 4) {
    return { ok: false, error: "BIND_ADDR host must be an IPv4 address or bracketed IPv6 address" };
  }

  return parseBindPort(parts[1], parts[0]);
}

export function isLoopbackBindHost(host) {
  if (!host) return false;
  return host === "::1" || host === "127.0.0.1" || host.startsWith("127.");
}

export function isLocalHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.")
  );
}

export function parseOrigin(value) {
  try {
    const url = new URL(value);
    return {
      ok:
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.pathname === "/" &&
        url.search === "" &&
        url.hash === "",
      protocol: url.protocol,
      hostname: url.hostname,
    };
  } catch {
    return {
      ok: false,
      protocol: null,
      hostname: null,
    };
  }
}

export function parseArgs(rawArgs) {
  const flagArgs = new Set(["allowDraining"]);
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue != null) {
      parsed[key] = inlineValue;
    } else if (flagArgs.has(key)) {
      parsed[key] = true;
    } else {
      parsed[key] = rawArgs[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function parseBindPort(value, host) {
  if (!/^\d+$/u.test(value)) {
    return { ok: false, error: "BIND_ADDR port must be numeric" };
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "BIND_ADDR port must be between 1 and 65535" };
  }
  return { ok: true, host, port };
}
