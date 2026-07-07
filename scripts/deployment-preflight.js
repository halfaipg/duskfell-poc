import net from "node:net";

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
const MAX_JWT_ISSUER_BYTES = 512;
const MAX_JWT_AUDIENCE_BYTES = 256;
const MAX_ALLOWED_ORIGINS = 16;
const MAX_ORIGIN_BYTES = 512;
const MAX_GIT_SHA_BYTES = 64;
const MAX_SERVICE_URL_BYTES = 512;
const BUDGET_LIMITS = {
  MAX_ACTIVE_CONNECTIONS: [1, 10_000],
  MAX_CONNECTIONS_PER_IP: [1, 10_000],
  MAX_CONNECTIONS_PER_ACCOUNT: [1, 1_000],
  SESSION_TICKET_CAPACITY: [1, 100_000],
  SESSION_TICKET_TTL_SECONDS: [1, 3_600],
  SESSION_ISSUE_RATE_LIMIT_PER_MINUTE: [1, 60_000],
  SESSION_ISSUE_RATE_LIMIT_BURST: [1, 10_000],
  SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS: [1, 100_000],
  ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE: [1, 60_000],
  ACCOUNT_SESSION_RATE_LIMIT_BURST: [1, 10_000],
  ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS: [1, 100_000],
  WS_MAX_TEXT_BYTES: [128, 65_536],
  WS_MESSAGE_BURST: [1, 1_000],
  WS_MESSAGE_REFILL_PER_SECOND: [1, 1_000],
  WS_MAX_INPUT_SEQUENCE_STEP: [1, 100_000],
  CLIENT_REJECT_LIMIT: [1, 100],
  SNAPSHOT_INTERVAL_MS: [1, 5_000],
  INTEREST_RADIUS: [1, 10_000],
  MAX_SNAPSHOT_BYTES: [1_024, 1_048_576],
  MAX_ADMIN_SNAPSHOT_BYTES: [1_024, 4_194_304],
  HTTP_BODY_LIMIT_BYTES: [256, 1_048_576],
  MAX_JOURNAL_BYTES: [1_024, 1_073_741_824],
  MAX_SETTLEMENT_OUTBOX_BYTES: [1_024, 1_073_741_824],
  MAX_DURABLE_LINE_BYTES: [128, 1_048_576],
  MAX_RUNTIME_MANIFEST_BYTES: [1_024, 1_048_576],
  MAX_RUNTIME_ASSET_BYTES: [1_024, 10_485_760],
  MAX_CONTENT_OBJECTS: [1, 100_000],
  ADMIN_EVENT_LIMIT_CAP: [1, 10_000],
  WS_HEARTBEAT_SECONDS: [1, 300],
  WS_IDLE_TIMEOUT_SECONDS: [2, 3_600],
};

const checks = [];

if (!["local", "shared-poc", "production"].includes(profile)) {
  throw new Error("--profile must be one of: local, shared-poc, production");
}

checkKnownProfile();
checkDeploymentProfile();
checkPersistenceBackend();
checkAdmissionBackend();
checkPublicMode();
checkBuildProvenance();
checkAccountAuth();
checkOrigins();
checkBind();
checkChainMode();
checkProductionChainServices();
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

function checkDeploymentProfile() {
  const runtimeProfile = env.DEPLOYMENT_PROFILE ?? "local";
  const known = ["local", "shared-poc", "production"].includes(runtimeProfile);
  add(
    "deployment-profile-known",
    known,
    "error",
    "DEPLOYMENT_PROFILE must be local, shared-poc, or production when set",
  );
  if (!known) {
    return;
  }

  if (profile === "local") {
    add(
      "local-deployment-profile",
      runtimeProfile === "local",
      "warn",
      "local preflight should use DEPLOYMENT_PROFILE=local or leave it unset",
    );
    return;
  }

  add(
    "deployment-profile-matches-profile",
    runtimeProfile === profile,
    "error",
    `DEPLOYMENT_PROFILE must be ${profile} for --profile ${profile}`,
  );
}

function checkPersistenceBackend() {
  const backend = env.PERSISTENCE_BACKEND ?? "jsonl";
  const known = ["jsonl", "postgres"].includes(backend);
  add(
    "persistence-backend-known",
    known,
    "error",
    "PERSISTENCE_BACKEND must be jsonl or postgres when set",
  );
  if (!known) {
    return;
  }

  if (profile !== "local") {
    add(
      "persistence-backend-explicit",
      Boolean(env.PERSISTENCE_BACKEND),
      "error",
      "shared and production profiles require explicit PERSISTENCE_BACKEND",
    );
  }

  if (profile === "production") {
    add(
      "production-persistence-backend-postgres",
      backend === "postgres",
      "error",
      "production requires PERSISTENCE_BACKEND=postgres",
    );
    add(
      "production-database-url-present",
      Boolean(env.DATABASE_URL),
      "error",
      "production requires DATABASE_URL for the Postgres event-store",
    );
    add(
      "production-database-url-bounded",
      typeof env.DATABASE_URL === "string" && Buffer.byteLength(env.DATABASE_URL) <= 4096,
      "error",
      "DATABASE_URL must be at most 4096 bytes",
    );
    add(
      "production-database-url-postgres",
      typeof env.DATABASE_URL === "string" &&
        (env.DATABASE_URL.startsWith("postgres://") || env.DATABASE_URL.startsWith("postgresql://")),
      "error",
      "DATABASE_URL must use postgres:// or postgresql://",
    );
    return;
  }

  add(
    "persistence-backend-jsonl",
    backend === "jsonl",
    profile === "local" ? "warn" : "error",
    "local and shared-poc profiles use PERSISTENCE_BACKEND=jsonl until the Postgres event-store is implemented",
  );
}

function checkAdmissionBackend() {
  const backend = env.ADMISSION_BACKEND ?? "in-memory";
  const known = ["in-memory", "redis"].includes(backend);
  add(
    "admission-backend-known",
    known,
    "error",
    "ADMISSION_BACKEND must be in-memory or redis when set",
  );
  if (!known) {
    return;
  }

  if (profile !== "local") {
    add(
      "admission-backend-explicit",
      Boolean(env.ADMISSION_BACKEND),
      "error",
      "shared and production profiles require explicit ADMISSION_BACKEND",
    );
  }

  if (profile === "production") {
    add(
      "production-admission-backend-redis",
      backend === "redis",
      "error",
      "production requires ADMISSION_BACKEND=redis",
    );
    add(
      "production-redis-url-present",
      Boolean(env.REDIS_URL),
      "error",
      "production requires REDIS_URL for shared session/admission/rate-limit state",
    );
    add(
      "production-redis-url-bounded",
      typeof env.REDIS_URL === "string" && Buffer.byteLength(env.REDIS_URL) <= 4096,
      "error",
      "REDIS_URL must be at most 4096 bytes",
    );
    add(
      "production-redis-url-redis",
      hasValidRedisUrl(),
      "error",
      "REDIS_URL must use redis:// or rediss://",
    );
    return;
  }

  add(
    "admission-backend-in-memory",
    backend === "in-memory",
    profile === "local" ? "warn" : "error",
    "local and shared-poc profiles use ADMISSION_BACKEND=in-memory until Redis admission state is implemented",
  );
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

function checkBuildProvenance() {
  if (profile === "local") {
    add(
      "local-build-git-sha-optional",
      true,
      "warn",
      "local profile may omit GIT_SHA",
    );
    return;
  }

  const gitSha = env.GIT_SHA;
  add("build-git-sha-present", Boolean(gitSha), "error", "GIT_SHA must be set");
  add(
    "build-git-sha-bounded",
    typeof gitSha === "string" && Buffer.byteLength(gitSha) <= MAX_GIT_SHA_BYTES,
    "error",
    `GIT_SHA must be at most ${MAX_GIT_SHA_BYTES} bytes`,
  );
  add(
    "build-git-sha-format",
    typeof gitSha === "string" && /^[0-9a-f]{7,64}$/iu.test(gitSha),
    "error",
    "GIT_SHA must be a 7-64 character hexadecimal Git revision",
  );
  add(
    "build-git-sha-not-unknown",
    typeof gitSha === "string" && gitSha.toLowerCase() !== "unknown",
    "error",
    "GIT_SHA must not use the Dockerfile unknown default",
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
    add(
      "account-jwt-issuer-bounded",
      typeof env.ACCOUNT_JWT_ISSUER === "string" &&
        Buffer.byteLength(env.ACCOUNT_JWT_ISSUER) <= MAX_JWT_ISSUER_BYTES,
      "error",
      `ACCOUNT_JWT_ISSUER must be at most ${MAX_JWT_ISSUER_BYTES} bytes`,
    );
    add(
      "account-jwt-issuer-trimmed",
      typeof env.ACCOUNT_JWT_ISSUER === "string" &&
        env.ACCOUNT_JWT_ISSUER.trim() === env.ACCOUNT_JWT_ISSUER,
      "error",
      "ACCOUNT_JWT_ISSUER must not have surrounding whitespace",
    );
    add(
      "account-jwt-issuer-url",
      isPublicJwtIssuer(env.ACCOUNT_JWT_ISSUER),
      "error",
      "ACCOUNT_JWT_ISSUER must be an https issuer URL with a non-local host and no query, fragment, or userinfo",
    );
    add(
      "account-jwt-audience-bounded",
      typeof env.ACCOUNT_JWT_AUDIENCE === "string" &&
        Buffer.byteLength(env.ACCOUNT_JWT_AUDIENCE) <= MAX_JWT_AUDIENCE_BYTES,
      "error",
      `ACCOUNT_JWT_AUDIENCE must be at most ${MAX_JWT_AUDIENCE_BYTES} bytes`,
    );
    add(
      "account-jwt-audience-trimmed",
      typeof env.ACCOUNT_JWT_AUDIENCE === "string" &&
        env.ACCOUNT_JWT_AUDIENCE.trim() === env.ACCOUNT_JWT_AUDIENCE,
      "error",
      "ACCOUNT_JWT_AUDIENCE must not have surrounding whitespace",
    );
    add(
      "account-jwt-audience-printable",
      isCompactPrintable(env.ACCOUNT_JWT_AUDIENCE),
      "error",
      "ACCOUNT_JWT_AUDIENCE must not contain whitespace or control characters",
    );
    add(
      "account-jwt-audience-not-placeholder",
      typeof env.ACCOUNT_JWT_AUDIENCE === "string" &&
        !looksLikePlaceholderSecret(env.ACCOUNT_JWT_AUDIENCE),
      "error",
      "ACCOUNT_JWT_AUDIENCE must not use placeholder text",
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

function checkChainMode() {
  add(
    "chain-mode-disabled",
    boolEnv("CHAIN_ENABLED") !== true,
    profile === "local" ? "warn" : "error",
    "CHAIN_ENABLED is a local-only stub until signer/indexer services exist",
  );
}

function checkProductionChainServices() {
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

function checkNumericBudgets() {
  const budgets = {
    MAX_ACTIVE_CONNECTIONS: integerBudget("MAX_ACTIVE_CONNECTIONS", 512),
    MAX_CONNECTIONS_PER_IP: integerBudget("MAX_CONNECTIONS_PER_IP", 64),
    MAX_CONNECTIONS_PER_ACCOUNT: integerBudget("MAX_CONNECTIONS_PER_ACCOUNT", 4),
    SESSION_TICKET_CAPACITY: integerBudget("SESSION_TICKET_CAPACITY", 2048),
    SESSION_TICKET_TTL_SECONDS: integerBudget("SESSION_TICKET_TTL_SECONDS", 30),
    SESSION_ISSUE_RATE_LIMIT_PER_MINUTE: integerBudget("SESSION_ISSUE_RATE_LIMIT_PER_MINUTE", 120),
    SESSION_ISSUE_RATE_LIMIT_BURST: integerBudget("SESSION_ISSUE_RATE_LIMIT_BURST", 30),
    SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS: integerBudget("SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS", 4096),
    ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE: integerBudget("ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE", 60),
    ACCOUNT_SESSION_RATE_LIMIT_BURST: integerBudget("ACCOUNT_SESSION_RATE_LIMIT_BURST", 10),
    ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS: integerBudget("ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS", 4096),
    WS_MAX_TEXT_BYTES: integerBudget("WS_MAX_TEXT_BYTES", 4096),
    WS_MESSAGE_BURST: integerBudget("WS_MESSAGE_BURST", 20),
    WS_MESSAGE_REFILL_PER_SECOND: integerBudget("WS_MESSAGE_REFILL_PER_SECOND", 30),
    WS_MAX_INPUT_SEQUENCE_STEP: integerBudget("WS_MAX_INPUT_SEQUENCE_STEP", 120),
    CLIENT_REJECT_LIMIT: integerBudget("CLIENT_REJECT_LIMIT", 8),
    SNAPSHOT_INTERVAL_MS: integerBudget("SNAPSHOT_INTERVAL_MS", 50),
    INTEREST_RADIUS: floatBudget("INTEREST_RADIUS", 520),
    MAX_SNAPSHOT_BYTES: integerBudget("MAX_SNAPSHOT_BYTES", 65_536),
    MAX_ADMIN_SNAPSHOT_BYTES: integerBudget("MAX_ADMIN_SNAPSHOT_BYTES", 262_144),
    HTTP_BODY_LIMIT_BYTES: integerBudget("HTTP_BODY_LIMIT_BYTES", 4096),
    MAX_JOURNAL_BYTES: integerBudget("MAX_JOURNAL_BYTES", 16 * 1024 * 1024),
    MAX_SETTLEMENT_OUTBOX_BYTES: integerBudget("MAX_SETTLEMENT_OUTBOX_BYTES", 16 * 1024 * 1024),
    MAX_DURABLE_LINE_BYTES: integerBudget("MAX_DURABLE_LINE_BYTES", 256 * 1024),
    MAX_RUNTIME_MANIFEST_BYTES: integerBudget("MAX_RUNTIME_MANIFEST_BYTES", 256 * 1024),
    MAX_RUNTIME_ASSET_BYTES: integerBudget("MAX_RUNTIME_ASSET_BYTES", 2 * 1024 * 1024),
    MAX_CONTENT_OBJECTS: integerBudget("MAX_CONTENT_OBJECTS", 10_000),
    ADMIN_EVENT_LIMIT_CAP: integerBudget("ADMIN_EVENT_LIMIT_CAP", 200),
    WS_HEARTBEAT_SECONDS: integerBudget("WS_HEARTBEAT_SECONDS", 30),
    WS_IDLE_TIMEOUT_SECONDS: integerBudget("WS_IDLE_TIMEOUT_SECONDS", 180),
  };

  add(
    "max_connections_per_ip-within-active-connections",
    budgets.MAX_CONNECTIONS_PER_IP.value <= budgets.MAX_ACTIVE_CONNECTIONS.value,
    "error",
    "MAX_CONNECTIONS_PER_IP must be <= MAX_ACTIVE_CONNECTIONS",
  );
  add(
    "max_connections_per_account-within-active-connections",
    budgets.MAX_CONNECTIONS_PER_ACCOUNT.value <= budgets.MAX_ACTIVE_CONNECTIONS.value,
    "error",
    "MAX_CONNECTIONS_PER_ACCOUNT must be <= MAX_ACTIVE_CONNECTIONS",
  );
  add(
    "session_issue_rate_limit_burst-within-per-minute",
    budgets.SESSION_ISSUE_RATE_LIMIT_BURST.value <=
      budgets.SESSION_ISSUE_RATE_LIMIT_PER_MINUTE.value,
    "error",
    "SESSION_ISSUE_RATE_LIMIT_BURST must be <= SESSION_ISSUE_RATE_LIMIT_PER_MINUTE",
  );
  add(
    "account_session_rate_limit_burst-within-per-minute",
    budgets.ACCOUNT_SESSION_RATE_LIMIT_BURST.value <=
      budgets.ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE.value,
    "error",
    "ACCOUNT_SESSION_RATE_LIMIT_BURST must be <= ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE",
  );
  add(
    "ws_idle_timeout_seconds-greater-than-heartbeat",
    budgets.WS_IDLE_TIMEOUT_SECONDS.value > budgets.WS_HEARTBEAT_SECONDS.value,
    "error",
    "WS_IDLE_TIMEOUT_SECONDS must be greater than WS_HEARTBEAT_SECONDS",
  );
}

function checkDurabilityMode() {
  const value = env.DURABLE_SYNC_WRITES;
  const enabled = boolEnv("DURABLE_SYNC_WRITES") === true;
  const journalPath = env.JOURNAL_PATH ?? "var/journal.jsonl";
  const settlementOutboxPath = env.SETTLEMENT_OUTBOX_PATH ?? "var/settlement-outbox.jsonl";
  add(
    "durable-sync-writes-boolean",
    value == null || boolEnv("DURABLE_SYNC_WRITES") != null,
    "error",
    "DURABLE_SYNC_WRITES must be true or false when set",
  );
  add(
    "durable-sync-writes-enabled",
    profile === "local" || enabled,
    "error",
    "shared and production profiles require DURABLE_SYNC_WRITES=true while JSONL is the durable store",
  );
  add(
    "durable-paths-distinct",
    journalPath !== settlementOutboxPath,
    "error",
    "JOURNAL_PATH and SETTLEMENT_OUTBOX_PATH must be distinct durable files",
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
    env.ACCOUNT_AUTH_MODE === "jwt-hs256" && hasValidJwtIdentityConfig(),
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
    hasValidSignerIndexerConfig(),
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

function hasValidRedisUrl() {
  return (
    typeof env.REDIS_URL === "string" &&
    Buffer.byteLength(env.REDIS_URL) <= 4096 &&
    (env.REDIS_URL.startsWith("redis://") || env.REDIS_URL.startsWith("rediss://"))
  );
}

function hasValidSignerIndexerConfig() {
  return isPublicServiceUrl(env.SIGNER_SERVICE_URL) && isPublicServiceUrl(env.INDEXER_SERVICE_URL);
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

function integerBudget(name, defaultValue) {
  const raw = env[name] ?? String(defaultValue);
  const [min, max] = BUDGET_LIMITS[name];
  const value = /^\d+$/u.test(raw) ? Number(raw) : NaN;
  add(
    `${name.toLowerCase()}-numeric`,
    Number.isSafeInteger(value),
    "error",
    `${name} must be an integer`,
  );
  add(
    `${name.toLowerCase()}-bounded`,
    Number.isSafeInteger(value) && value >= min && value <= max,
    "error",
    `${name} must be between ${min} and ${max}`,
  );
  return { name, value };
}

function floatBudget(name, defaultValue) {
  const raw = env[name] ?? String(defaultValue);
  const [min, max] = BUDGET_LIMITS[name];
  const value = Number(raw);
  add(
    `${name.toLowerCase()}-numeric`,
    Number.isFinite(value),
    "error",
    `${name} must be numeric`,
  );
  add(
    `${name.toLowerCase()}-bounded`,
    Number.isFinite(value) && value >= min && value <= max,
    "error",
    `${name} must be between ${min} and ${max}`,
  );
  return { name, value };
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

function hasValidJwtIdentityConfig() {
  return (
    typeof env.ACCOUNT_JWT_HS256_SECRET === "string" &&
    Buffer.byteLength(env.ACCOUNT_JWT_HS256_SECRET) >= 24 &&
    Buffer.byteLength(env.ACCOUNT_JWT_HS256_SECRET) <= MAX_AUTH_TOKEN_BYTES &&
    env.ACCOUNT_JWT_HS256_SECRET.trim() === env.ACCOUNT_JWT_HS256_SECRET &&
    !looksLikePlaceholderSecret(env.ACCOUNT_JWT_HS256_SECRET) &&
    isPublicJwtIssuer(env.ACCOUNT_JWT_ISSUER) &&
    typeof env.ACCOUNT_JWT_AUDIENCE === "string" &&
    Buffer.byteLength(env.ACCOUNT_JWT_AUDIENCE) <= MAX_JWT_AUDIENCE_BYTES &&
    env.ACCOUNT_JWT_AUDIENCE.trim() === env.ACCOUNT_JWT_AUDIENCE &&
    isCompactPrintable(env.ACCOUNT_JWT_AUDIENCE) &&
    !looksLikePlaceholderSecret(env.ACCOUNT_JWT_AUDIENCE)
  );
}

function isPublicJwtIssuer(value) {
  if (typeof value !== "string") return false;
  if (Buffer.byteLength(value) > MAX_JWT_ISSUER_BYTES) return false;
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

function isCompactPrintable(value) {
  return typeof value === "string" && value.length > 0 && !/[\s\x00-\x1f\x7f]/u.test(value);
}

function looksLikePlaceholderSecret(value) {
  const normalized = value.toLowerCase();
  return PLACEHOLDER_SECRET_MARKERS.some((marker) => normalized.includes(marker));
}

function parseBindAddr(value) {
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

function isLoopbackBindHost(host) {
  if (!host) return false;
  return host === "::1" || host === "127.0.0.1" || host.startsWith("127.");
}

function isLocalHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.")
  );
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
