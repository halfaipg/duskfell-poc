const args = parseArgs(process.argv.slice(2));
const profile = args.profile ?? "shared-poc";
const env = process.env;
const PLACEHOLDER_SECRET_MARKERS = [
  "replace-with",
  "placeholder",
  "changeme",
  "change-me",
  "todo",
];
const MAX_AUTH_TOKEN_BYTES = 4096;
const MAX_ALLOWED_ORIGINS = 16;
const MAX_ORIGIN_BYTES = 512;

const checks = [];

if (!["local", "shared-poc", "production"].includes(profile)) {
  throw new Error("--profile must be one of: local, shared-poc, production");
}

checkKnownProfile();
checkPublicMode();
checkAccountAuth();
checkOrigins();
checkBind();
checkChainMode();
checkNumericBudgets();
checkDurabilityMode();
checkDrainMode();
checkProductionBlockers();

const errors = checks.filter((check) => check.level === "error" && !check.ok);
const warnings = checks.filter((check) => check.level === "warn" && !check.ok);
const result = {
  profile,
  ok: errors.length === 0,
  errors: errors.length,
  warnings: warnings.length,
  checks,
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}

function checkKnownProfile() {
  add("profile-known", true, "error", `profile=${profile}`);
}

function checkPublicMode() {
  if (profile === "local") {
    add(
      "local-public-deployment-disabled",
      boolEnv("PUBLIC_DEPLOYMENT") !== true,
      "warn",
      "local profile should normally leave PUBLIC_DEPLOYMENT unset",
    );
    return;
  }

  add(
    "public-deployment-enabled",
    boolEnv("PUBLIC_DEPLOYMENT") === true,
    "error",
    "shared and production profiles require PUBLIC_DEPLOYMENT=true",
  );
  add(
    "session-required",
    boolEnv("REQUIRE_SESSION") === true,
    "error",
    "shared and production profiles require REQUIRE_SESSION=true",
  );
  add(
    "account-gate-required",
    boolEnv("REQUIRE_ACCOUNT") === true,
    "error",
    "shared and production profiles require REQUIRE_ACCOUNT=true",
  );
}

function checkAccountAuth() {
  if (profile === "local") {
    return;
  }

  const accountMode = env.ACCOUNT_AUTH_MODE ?? "dev-token";
  add(
    "account-auth-mode-supported",
    accountMode === "dev-token" || accountMode === "jwt-hs256",
    "error",
    "ACCOUNT_AUTH_MODE must be dev-token or jwt-hs256",
  );

  const tokens = [
    ["ADMIN_TOKEN", env.ADMIN_TOKEN],
    ["METRICS_TOKEN", env.METRICS_TOKEN],
  ];
  let accountCredential = null;

  if (accountMode === "dev-token") {
    tokens.unshift(["DEV_ACCOUNT_TOKEN", env.DEV_ACCOUNT_TOKEN]);
    accountCredential = ["DEV_ACCOUNT_TOKEN", env.DEV_ACCOUNT_TOKEN];
  } else if (accountMode === "jwt-hs256") {
    tokens.unshift(["ACCOUNT_JWT_HS256_SECRET", env.ACCOUNT_JWT_HS256_SECRET]);
    accountCredential = ["ACCOUNT_JWT_HS256_SECRET", env.ACCOUNT_JWT_HS256_SECRET];
    add(
      "account-jwt-issuer-present",
      Boolean(env.ACCOUNT_JWT_ISSUER),
      "error",
      "ACCOUNT_JWT_ISSUER must be set for jwt-hs256 mode",
    );
    add(
      "account-jwt-audience-present",
      Boolean(env.ACCOUNT_JWT_AUDIENCE),
      "error",
      "ACCOUNT_JWT_AUDIENCE must be set for jwt-hs256 mode",
    );
  }

  for (const [name, token] of tokens) {
    add(`${name.toLowerCase()}-present`, Boolean(token), "error", `${name} must be set`);
    add(
      `${name.toLowerCase()}-strong`,
      typeof token === "string" && Buffer.byteLength(token) >= 24,
      "error",
      `${name} must be at least 24 bytes`,
    );
    add(
      `${name.toLowerCase()}-bounded`,
      typeof token === "string" && Buffer.byteLength(token) <= MAX_AUTH_TOKEN_BYTES,
      "error",
      `${name} must be at most ${MAX_AUTH_TOKEN_BYTES} bytes`,
    );
    add(
      `${name.toLowerCase()}-trimmed`,
      typeof token === "string" && token.trim() === token,
      "error",
      `${name} must not have surrounding whitespace`,
    );
    add(
      `${name.toLowerCase()}-not-placeholder`,
      typeof token === "string" && !looksLikePlaceholderSecret(token),
      "error",
      `${name} must not use placeholder text`,
    );
  }

  const presentValues = tokens.map(([, token]) => token).filter(Boolean);
  add(
    "auth-credentials-distinct",
    new Set(presentValues).size === presentValues.length,
    "error",
    `${accountCredential?.[0] ?? "account credential"}, admin, and metrics credentials must be distinct`,
  );
}

function checkOrigins() {
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

function checkBind() {
  const bindAddr = env.BIND_ADDR ?? "127.0.0.1:4107";
  const host = bindAddrHost(bindAddr);
  const loopback = isLoopbackBindHost(host);
  add("bind-addr-parse", Boolean(host), "error", "BIND_ADDR must include a host and port");
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

function checkChainMode() {
  add(
    "chain-mode-disabled",
    boolEnv("CHAIN_ENABLED") !== true,
    profile === "local" ? "warn" : "error",
    "CHAIN_ENABLED is a local-only stub until signer/indexer services exist",
  );
}

function checkNumericBudgets() {
  positiveNumber("MAX_ACTIVE_CONNECTIONS", 512, 1);
  positiveNumber("MAX_CONNECTIONS_PER_IP", 64, 1);
  positiveNumber("SESSION_TICKET_CAPACITY", 2048, 1);
  positiveNumber("SESSION_TICKET_TTL_SECONDS", 30, 1);
  positiveNumber("SESSION_ISSUE_RATE_LIMIT_PER_MINUTE", 120, 1);
  positiveNumber("SESSION_ISSUE_RATE_LIMIT_BURST", 30, 1);
  positiveNumber("SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS", 4096, 1);
  positiveNumber("ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE", 60, 1);
  positiveNumber("ACCOUNT_SESSION_RATE_LIMIT_BURST", 10, 1);
  positiveNumber("ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS", 4096, 1);
  positiveNumber("WS_MAX_TEXT_BYTES", 4096, 128);
  positiveNumber("WS_MESSAGE_BURST", 20, 1);
  positiveNumber("WS_MESSAGE_REFILL_PER_SECOND", 30, 1);
  positiveNumber("CLIENT_REJECT_LIMIT", 8, 1);
  positiveNumber("SNAPSHOT_INTERVAL_MS", 50, 1);
  positiveNumber("INTEREST_RADIUS", 520, 1);
  positiveNumber("MAX_SNAPSHOT_BYTES", 65_536, 1024);
  positiveNumber("MAX_ADMIN_SNAPSHOT_BYTES", 262_144, 1024);
  positiveNumber("HTTP_BODY_LIMIT_BYTES", 4096, 256);
  positiveNumber("MAX_JOURNAL_BYTES", 16 * 1024 * 1024, 1024);
  positiveNumber("MAX_SETTLEMENT_OUTBOX_BYTES", 16 * 1024 * 1024, 1024);
  positiveNumber("MAX_DURABLE_LINE_BYTES", 256 * 1024, 128);
  positiveNumber("MAX_RUNTIME_MANIFEST_BYTES", 256 * 1024, 1024);
  positiveNumber("MAX_RUNTIME_ASSET_BYTES", 2 * 1024 * 1024, 1024);
  positiveNumber("MAX_CONTENT_OBJECTS", 10_000, 1);
  positiveNumber("ADMIN_EVENT_LIMIT_CAP", 200, 1);
}

function checkDurabilityMode() {
  const value = env.DURABLE_SYNC_WRITES;
  add(
    "durable-sync-writes-boolean",
    value == null || boolEnv("DURABLE_SYNC_WRITES") != null,
    "error",
    "DURABLE_SYNC_WRITES must be true or false when set",
  );
}

function checkDrainMode() {
  const value = env.DRAINING;
  const draining = boolEnv("DRAINING");
  const allowDraining = args.allowDraining === true || args.allowDraining === "true";

  add(
    "draining-boolean",
    value == null || draining != null,
    "error",
    "DRAINING must be true or false when set",
  );

  if (profile === "local") {
    add(
      "local-draining-disabled",
      draining !== true,
      "warn",
      "local profile should normally leave DRAINING unset unless testing drain mode",
    );
    return;
  }

  add(
    "not-draining",
    draining !== true || allowDraining,
    "error",
    allowDraining
      ? "drain mode explicitly allowed by --allowDraining"
      : "shared and production profiles should not boot drained unless --allowDraining was passed",
  );
}

function checkProductionBlockers() {
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
    env.ACCOUNT_AUTH_MODE === "jwt-hs256" &&
      Boolean(env.ACCOUNT_JWT_HS256_SECRET) &&
      Boolean(env.ACCOUNT_JWT_ISSUER) &&
      Boolean(env.ACCOUNT_JWT_AUDIENCE),
    "error",
    "production needs signed account JWT validation instead of DEV_ACCOUNT_TOKEN",
  );
  add(
    "durable-database-configured",
    false,
    "error",
    "production needs a database/event-store for accounts, characters, inventory, audit events, and settlement jobs",
  );
  add(
    "signer-indexer-configured",
    false,
    "error",
    "production needs isolated signer and indexer services before chain settlement can be authoritative",
  );
  add(
    "cross-process-rate-limits-configured",
    false,
    "error",
    "production needs shared session/admission/rate-limit state outside one sim process",
  );
}

function positiveNumber(name, defaultValue, min) {
  const raw = env[name] ?? String(defaultValue);
  const value = Number(raw);
  add(
    `${name.toLowerCase()}-numeric`,
    Number.isFinite(value) && value >= min,
    "error",
    `${name} must be numeric and >= ${min}`,
  );
}

function add(name, ok, level, detail) {
  checks.push({ name, ok, level, detail });
}

function boolEnv(name) {
  const value = env[name];
  if (value == null) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function looksLikePlaceholderSecret(value) {
  const normalized = value.toLowerCase();
  return PLACEHOLDER_SECRET_MARKERS.some((marker) => normalized.includes(marker));
}

function bindAddrHost(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? null : trimmed.slice(1, end);
  }
  const index = trimmed.lastIndexOf(":");
  return index <= 0 ? null : trimmed.slice(0, index);
}

function isLoopbackBindHost(host) {
  if (!host) return false;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function parseOrigin(value) {
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

function parseArgs(rawArgs) {
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
