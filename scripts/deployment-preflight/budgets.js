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

export function checkNumericBudgets(env, add) {
  const budgets = {
    MAX_ACTIVE_CONNECTIONS: integerBudget(env, add, "MAX_ACTIVE_CONNECTIONS", 512),
    MAX_CONNECTIONS_PER_IP: integerBudget(env, add, "MAX_CONNECTIONS_PER_IP", 64),
    MAX_CONNECTIONS_PER_ACCOUNT: integerBudget(env, add, "MAX_CONNECTIONS_PER_ACCOUNT", 4),
    SESSION_TICKET_CAPACITY: integerBudget(env, add, "SESSION_TICKET_CAPACITY", 2048),
    SESSION_TICKET_TTL_SECONDS: integerBudget(env, add, "SESSION_TICKET_TTL_SECONDS", 30),
    SESSION_ISSUE_RATE_LIMIT_PER_MINUTE: integerBudget(
      env,
      add,
      "SESSION_ISSUE_RATE_LIMIT_PER_MINUTE",
      120,
    ),
    SESSION_ISSUE_RATE_LIMIT_BURST: integerBudget(env, add, "SESSION_ISSUE_RATE_LIMIT_BURST", 30),
    SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS: integerBudget(
      env,
      add,
      "SESSION_ISSUE_RATE_LIMIT_MAX_CLIENTS",
      4096,
    ),
    ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE: integerBudget(
      env,
      add,
      "ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE",
      60,
    ),
    ACCOUNT_SESSION_RATE_LIMIT_BURST: integerBudget(
      env,
      add,
      "ACCOUNT_SESSION_RATE_LIMIT_BURST",
      10,
    ),
    ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS: integerBudget(
      env,
      add,
      "ACCOUNT_SESSION_RATE_LIMIT_MAX_SUBJECTS",
      4096,
    ),
    WS_MAX_TEXT_BYTES: integerBudget(env, add, "WS_MAX_TEXT_BYTES", 4096),
    WS_MESSAGE_BURST: integerBudget(env, add, "WS_MESSAGE_BURST", 20),
    WS_MESSAGE_REFILL_PER_SECOND: integerBudget(env, add, "WS_MESSAGE_REFILL_PER_SECOND", 30),
    WS_MAX_INPUT_SEQUENCE_STEP: integerBudget(env, add, "WS_MAX_INPUT_SEQUENCE_STEP", 120),
    CLIENT_REJECT_LIMIT: integerBudget(env, add, "CLIENT_REJECT_LIMIT", 8),
    SNAPSHOT_INTERVAL_MS: integerBudget(env, add, "SNAPSHOT_INTERVAL_MS", 50),
    INTEREST_RADIUS: floatBudget(env, add, "INTEREST_RADIUS", 520),
    MAX_SNAPSHOT_BYTES: integerBudget(env, add, "MAX_SNAPSHOT_BYTES", 65_536),
    MAX_ADMIN_SNAPSHOT_BYTES: integerBudget(env, add, "MAX_ADMIN_SNAPSHOT_BYTES", 262_144),
    HTTP_BODY_LIMIT_BYTES: integerBudget(env, add, "HTTP_BODY_LIMIT_BYTES", 4096),
    MAX_JOURNAL_BYTES: integerBudget(env, add, "MAX_JOURNAL_BYTES", 16 * 1024 * 1024),
    MAX_SETTLEMENT_OUTBOX_BYTES: integerBudget(
      env,
      add,
      "MAX_SETTLEMENT_OUTBOX_BYTES",
      16 * 1024 * 1024,
    ),
    MAX_DURABLE_LINE_BYTES: integerBudget(env, add, "MAX_DURABLE_LINE_BYTES", 256 * 1024),
    MAX_RUNTIME_MANIFEST_BYTES: integerBudget(env, add, "MAX_RUNTIME_MANIFEST_BYTES", 256 * 1024),
    MAX_RUNTIME_ASSET_BYTES: integerBudget(env, add, "MAX_RUNTIME_ASSET_BYTES", 2 * 1024 * 1024),
    MAX_CONTENT_OBJECTS: integerBudget(env, add, "MAX_CONTENT_OBJECTS", 10_000),
    ADMIN_EVENT_LIMIT_CAP: integerBudget(env, add, "ADMIN_EVENT_LIMIT_CAP", 200),
    WS_HEARTBEAT_SECONDS: integerBudget(env, add, "WS_HEARTBEAT_SECONDS", 30),
    WS_IDLE_TIMEOUT_SECONDS: integerBudget(env, add, "WS_IDLE_TIMEOUT_SECONDS", 180),
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

function integerBudget(env, add, name, defaultValue) {
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

function floatBudget(env, add, name, defaultValue) {
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
