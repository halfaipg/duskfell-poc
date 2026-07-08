import { hasValidJwtIdentityConfig } from "./auth.js";
import { isCompactPrintable, isLocalHost, isLoopbackBindHost, parseBindAddr, parseOrigin } from "./parsing.js";

const MAX_ALLOWED_ORIGINS = 16;
const MAX_ORIGIN_BYTES = 512;
const MAX_SERVICE_URL_BYTES = 512;

export function checkOrigins({ env, profile, add }) {
  if (profile === "local") {
    return;
  }

  const origins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const parsed = origins.map(parseOrigin);
  add("allowed-origins-present", origins.length > 0, "error", "ALLOWED_ORIGINS must be set");
  add(
    "allowed-origins-count",
    origins.length > 0 && origins.length <= MAX_ALLOWED_ORIGINS,
    "error",
    `ALLOWED_ORIGINS must include at most ${MAX_ALLOWED_ORIGINS} origins`,
  );
  add(
    "allowed-origins-bounded",
    origins.length > 0 && origins.every((origin) => Buffer.byteLength(origin) <= MAX_ORIGIN_BYTES),
    "error",
    `ALLOWED_ORIGINS entries must be at most ${MAX_ORIGIN_BYTES} bytes`,
  );
  add(
    "allowed-origins-parse",
    origins.length > 0 && parsed.every((origin) => origin.ok),
    "error",
    "ALLOWED_ORIGINS entries must be exact http(s) origins",
  );
  add(
    "production-origins-https",
    profile !== "production" || parsed.every((origin) => origin.protocol === "https:"),
    "error",
    "production origins must use https",
  );
  add(
    "production-origins-nonlocal",
    profile !== "production" || parsed.every((origin) => !isLocalHost(origin.hostname)),
    "error",
    "production origins must not be localhost or loopback",
  );
}

export function checkBind({ env, profile, add }) {
  const bindAddr = env.BIND_ADDR ?? "127.0.0.1:4107";
  const parsed = parseBindAddr(bindAddr);
  const loopback = parsed.ok && isLoopbackBindHost(parsed.host);
  add(
    "bind-addr-parse",
    parsed.ok,
    "error",
    parsed.ok ? `BIND_ADDR=${parsed.host}:${parsed.port}` : parsed.error,
  );
  if (profile === "local") {
    add("local-bind-loopback", loopback, "warn", "local profile should bind loopback only");
  } else {
    add(
      "shared-bind-explicit",
      Boolean(env.BIND_ADDR),
      "warn",
      "shared profiles should set BIND_ADDR explicitly",
    );
  }
}

export function checkChainMode({ env, profile, add, boolEnv }) {
  add(
    "chain-mode-disabled",
    boolEnv(env, "CHAIN_ENABLED") !== true,
    profile === "local" ? "warn" : "error",
    "CHAIN_ENABLED is a local-only stub until signer/indexer services exist",
  );
}

export function checkProductionChainServices({ env, profile, add }) {
  if (profile !== "production") {
    return;
  }

  add(
    "production-signer-service-url-present",
    Boolean(env.SIGNER_SERVICE_URL),
    "error",
    "production requires SIGNER_SERVICE_URL for isolated transaction signing",
  );
  add(
    "production-signer-service-url-bounded",
    isBoundedServiceUrl(env.SIGNER_SERVICE_URL),
    "error",
    `SIGNER_SERVICE_URL must be at most ${MAX_SERVICE_URL_BYTES} bytes`,
  );
  add(
    "production-signer-service-url-public-https",
    isPublicServiceUrl(env.SIGNER_SERVICE_URL),
    "error",
    "SIGNER_SERVICE_URL must be a public https URL with no query, fragment, userinfo, whitespace, or control characters",
  );
  add(
    "production-indexer-service-url-present",
    Boolean(env.INDEXER_SERVICE_URL),
    "error",
    "production requires INDEXER_SERVICE_URL for chain event reconciliation",
  );
  add(
    "production-indexer-service-url-bounded",
    isBoundedServiceUrl(env.INDEXER_SERVICE_URL),
    "error",
    `INDEXER_SERVICE_URL must be at most ${MAX_SERVICE_URL_BYTES} bytes`,
  );
  add(
    "production-indexer-service-url-public-https",
    isPublicServiceUrl(env.INDEXER_SERVICE_URL),
    "error",
    "INDEXER_SERVICE_URL must be a public https URL with no query, fragment, userinfo, whitespace, or control characters",
  );
}

export function checkProductionBlockers({ env, profile, add, hasValidRedisUrl }) {
  if (profile !== "production") {
    add(
      "production-profile-not-requested",
      true,
      "warn",
      "use --profile production to see final launch blockers",
    );
    return;
  }

  add(
    "real-account-provider-configured",
    env.ACCOUNT_AUTH_MODE === "jwt-hs256" && hasValidJwtIdentityConfig(env),
    "error",
    "production needs signed account JWT validation instead of DEV_ACCOUNT_TOKEN",
  );
  add(
    "durable-database-configured",
    env.PERSISTENCE_BACKEND === "postgres" &&
      typeof env.DATABASE_URL === "string" &&
      Buffer.byteLength(env.DATABASE_URL) <= 4096 &&
      (env.DATABASE_URL.startsWith("postgres://") ||
        env.DATABASE_URL.startsWith("postgresql://")),
    "error",
    "production needs a database/event-store for accounts, characters, inventory, audit events, and settlement jobs",
  );
  add(
    "signer-indexer-configured",
    isPublicServiceUrl(env.SIGNER_SERVICE_URL) && isPublicServiceUrl(env.INDEXER_SERVICE_URL),
    "error",
    "production needs isolated signer and indexer services before chain settlement can be authoritative",
  );
  add(
    "cross-process-rate-limits-configured",
    env.ADMISSION_BACKEND === "redis" && hasValidRedisUrl(),
    "error",
    "production needs shared session/admission/rate-limit state outside one sim process",
  );
}

export function hasValidRedisUrl(env) {
  return (
    typeof env.REDIS_URL === "string" &&
    Buffer.byteLength(env.REDIS_URL) <= 4096 &&
    (env.REDIS_URL.startsWith("redis://") || env.REDIS_URL.startsWith("rediss://"))
  );
}

function isBoundedServiceUrl(value) {
  return typeof value === "string" && Buffer.byteLength(value) <= MAX_SERVICE_URL_BYTES;
}

function isPublicServiceUrl(value) {
  if (!isBoundedServiceUrl(value)) return false;
  if (value.trim() !== value) return false;
  if (!isCompactPrintable(value)) return false;
  if (value.includes("?") || value.includes("#") || value.includes("@")) return false;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return (
    parsed.protocol === "https:" &&
    parsed.hostname.length > 0 &&
    !isLocalHost(parsed.hostname)
  );
}
