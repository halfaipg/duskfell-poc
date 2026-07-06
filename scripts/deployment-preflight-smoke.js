import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const startedAt = performance.now();

const cases = [
  {
    name: "shared-poc-defaults-fail",
    args: [],
    env: {},
    expectOk: false,
    expectedChecks: ["public-deployment-enabled", "session-required", "account-gate-required"],
  },
  {
    name: "shared-poc-hardened-pass",
    args: [],
    env: hardenedEnv(),
    expectOk: true,
    expectedChecks: [
      "deployment-profile-matches-profile",
      "persistence-backend-explicit",
      "persistence-backend-jsonl",
      "public-deployment-enabled",
      "build-git-sha-format",
      "auth-credentials-distinct",
      "chain-mode-disabled",
      "durable-sync-writes-enabled",
      "not-draining",
    ],
  },
  {
    name: "shared-poc-rejects-missing-deployment-profile",
    args: [],
    env: hardenedEnv({ DEPLOYMENT_PROFILE: undefined }),
    expectOk: false,
    expectedChecks: ["deployment-profile-known", "deployment-profile-matches-profile"],
  },
  {
    name: "shared-poc-rejects-missing-persistence-backend",
    args: [],
    env: hardenedEnv({ PERSISTENCE_BACKEND: undefined }),
    expectOk: false,
    expectedChecks: ["persistence-backend-known", "persistence-backend-explicit", "persistence-backend-jsonl"],
  },
  {
    name: "shared-poc-rejects-postgres-runtime-backend",
    args: [],
    env: hardenedEnv({ PERSISTENCE_BACKEND: "postgres" }),
    expectOk: false,
    expectedChecks: ["persistence-backend-known", "persistence-backend-jsonl"],
  },
  {
    name: "shared-poc-rejects-unsynced-durable-writes",
    args: [],
    env: hardenedEnv({ DURABLE_SYNC_WRITES: "false" }),
    expectOk: false,
    expectedChecks: ["durable-sync-writes-boolean", "durable-sync-writes-enabled"],
  },
  {
    name: "shared-poc-rejects-draining-by-default",
    args: [],
    env: hardenedEnv({ DRAINING: "true" }),
    expectOk: false,
    expectedChecks: ["draining-boolean", "not-draining"],
  },
  {
    name: "shared-poc-allows-explicit-drain",
    args: ["--allowDraining"],
    env: hardenedEnv({ DRAINING: "true" }),
    expectOk: true,
    expectedChecks: ["draining-boolean", "not-draining"],
    expectedOkChecks: ["not-draining"],
  },
  {
    name: "shared-poc-rejects-invalid-draining",
    args: [],
    env: hardenedEnv({ DRAINING: "maybe" }),
    expectOk: false,
    expectedChecks: ["draining-boolean", "not-draining"],
  },
  {
    name: "shared-poc-rejects-placeholder-secrets",
    args: [],
    env: hardenedEnv({
      DEV_ACCOUNT_TOKEN: "replace-with-strong-account-token",
      ADMIN_TOKEN: "replace-with-strong-admin-token",
      METRICS_TOKEN: "metrics-token-placeholder-123",
    }),
    expectOk: false,
    expectedChecks: [
      "dev_account_token-not-placeholder",
      "admin_token-not-placeholder",
      "metrics_token-not-placeholder",
    ],
  },
  {
    name: "shared-poc-rejects-oversized-secrets",
    args: [],
    env: hardenedEnv({
      DEV_ACCOUNT_TOKEN: "a".repeat(4097),
      ADMIN_TOKEN: "b".repeat(4097),
      METRICS_TOKEN: "c".repeat(4097),
    }),
    expectOk: false,
    expectedChecks: [
      "dev_account_token-bounded",
      "admin_token-bounded",
      "metrics_token-bounded",
    ],
  },
  {
    name: "shared-poc-rejects-too-many-origins",
    args: [],
    env: hardenedEnv({
      ALLOWED_ORIGINS: Array.from({ length: 17 }, (_, index) => `https://game-${index}.example`).join(","),
    }),
    expectOk: false,
    expectedChecks: ["allowed-origins-count"],
  },
  {
    name: "shared-poc-rejects-oversized-origin",
    args: [],
    env: hardenedEnv({
      ALLOWED_ORIGINS: `https://${"a".repeat(512)}`,
    }),
    expectOk: false,
    expectedChecks: ["allowed-origins-bounded"],
  },
  {
    name: "shared-poc-rejects-hostname-bind-addr",
    args: [],
    env: hardenedEnv({
      BIND_ADDR: "localhost:4107",
    }),
    expectOk: false,
    expectedChecks: ["bind-addr-parse"],
  },
  {
    name: "shared-poc-rejects-malformed-bind-addr-port",
    args: [],
    env: hardenedEnv({
      BIND_ADDR: "127.0.0.1:not-a-port",
    }),
    expectOk: false,
    expectedChecks: ["bind-addr-parse"],
  },
  {
    name: "shared-poc-accepts-bracketed-ipv6-bind-addr",
    args: [],
    env: hardenedEnv({
      BIND_ADDR: "[::1]:4107",
    }),
    expectOk: true,
    expectedChecks: ["bind-addr-parse"],
    expectedOkChecks: ["bind-addr-parse"],
  },
  {
    name: "shared-poc-rejects-missing-build-provenance",
    args: [],
    env: hardenedEnv({ GIT_SHA: undefined }),
    expectOk: false,
    expectedChecks: [
      "build-git-sha-present",
      "build-git-sha-bounded",
      "build-git-sha-format",
      "build-git-sha-not-unknown",
    ],
  },
  {
    name: "shared-poc-rejects-weak-build-provenance",
    args: [],
    env: hardenedEnv({ GIT_SHA: "unknown" }),
    expectOk: false,
    expectedChecks: ["build-git-sha-format", "build-git-sha-not-unknown"],
  },
  {
    name: "shared-poc-rejects-oversized-build-provenance",
    args: [],
    env: hardenedEnv({ GIT_SHA: "a".repeat(65) }),
    expectOk: false,
    expectedChecks: ["build-git-sha-bounded", "build-git-sha-format"],
  },
  {
    name: "shared-poc-rejects-oversized-numeric-budgets",
    args: [],
    env: hardenedEnv({
      MAX_ACTIVE_CONNECTIONS: "10001",
      SESSION_TICKET_CAPACITY: "100001",
      MAX_SNAPSHOT_BYTES: "1048577",
      MAX_JOURNAL_BYTES: "1073741825",
    }),
    expectOk: false,
    expectedChecks: [
      "max_active_connections-bounded",
      "session_ticket_capacity-bounded",
      "max_snapshot_bytes-bounded",
      "max_journal_bytes-bounded",
    ],
  },
  {
    name: "shared-poc-rejects-decimal-integer-budgets",
    args: [],
    env: hardenedEnv({
      SESSION_TICKET_CAPACITY: "1.5",
      WS_MESSAGE_BURST: "2.5",
    }),
    expectOk: false,
    expectedChecks: [
      "session_ticket_capacity-numeric",
      "ws_message_burst-numeric",
    ],
  },
  {
    name: "shared-poc-rejects-inconsistent-capacity-budgets",
    args: [],
    env: hardenedEnv({
      MAX_ACTIVE_CONNECTIONS: "10",
      MAX_CONNECTIONS_PER_IP: "11",
      MAX_CONNECTIONS_PER_ACCOUNT: "11",
      SESSION_ISSUE_RATE_LIMIT_PER_MINUTE: "10",
      SESSION_ISSUE_RATE_LIMIT_BURST: "11",
      ACCOUNT_SESSION_RATE_LIMIT_PER_MINUTE: "10",
      ACCOUNT_SESSION_RATE_LIMIT_BURST: "11",
      WS_HEARTBEAT_SECONDS: "30",
      WS_IDLE_TIMEOUT_SECONDS: "30",
    }),
    expectOk: false,
    expectedChecks: [
      "max_connections_per_ip-within-active-connections",
      "max_connections_per_account-within-active-connections",
      "session_issue_rate_limit_burst-within-per-minute",
      "account_session_rate_limit_burst-within-per-minute",
      "ws_idle_timeout_seconds-greater-than-heartbeat",
    ],
  },
  {
    name: "shared-poc-jwt-pass",
    args: [],
    env: jwtEnv(),
    expectOk: true,
    expectedChecks: [
      "account-auth-mode-supported",
      "account-jwt-issuer-present",
      "account-jwt-audience-present",
      "auth-credentials-distinct",
    ],
  },
  {
    name: "shared-poc-rejects-weak-jwt-identity-config",
    args: [],
    env: jwtEnv({
      ACCOUNT_JWT_ISSUER: "https://127.0.0.1/issuer?debug=true",
      ACCOUNT_JWT_AUDIENCE: " replace-with-audience ",
    }),
    expectOk: false,
    expectedChecks: [
      "account-jwt-issuer-url",
      "account-jwt-audience-trimmed",
      "account-jwt-audience-printable",
      "account-jwt-audience-not-placeholder",
    ],
  },
  {
    name: "shared-poc-rejects-oversized-jwt-identity-config",
    args: [],
    env: jwtEnv({
      ACCOUNT_JWT_ISSUER: `https://${"a".repeat(512)}`,
      ACCOUNT_JWT_AUDIENCE: "a".repeat(257),
    }),
    expectOk: false,
    expectedChecks: [
      "account-jwt-issuer-bounded",
      "account-jwt-audience-bounded",
    ],
  },
  {
    name: "shared-poc-rejects-invalid-durable-sync",
    args: [],
    env: hardenedEnv({ DURABLE_SYNC_WRITES: "maybe" }),
    expectOk: false,
    expectedChecks: ["durable-sync-writes-boolean"],
  },
  {
    name: "shared-poc-rejects-shared-durable-path",
    args: [],
    env: hardenedEnv({
      JOURNAL_PATH: "var/shared-durable.jsonl",
      SETTLEMENT_OUTBOX_PATH: "var/shared-durable.jsonl",
    }),
    expectOk: false,
    expectedChecks: ["durable-paths-distinct"],
  },
  {
    name: "production-remains-blocked",
    args: ["--profile", "production"],
    env: hardenedEnv({
      DEPLOYMENT_PROFILE: "production",
      ALLOWED_ORIGINS: "https://play.example",
      BIND_ADDR: "0.0.0.0:4107",
    }),
    expectOk: false,
    expectedChecks: [
      "production-persistence-backend-postgres",
      "production-database-url-present",
      "real-account-provider-configured",
      "durable-database-configured",
      "signer-indexer-configured",
      "cross-process-rate-limits-configured",
    ],
  },
  {
    name: "production-jwt-clears-identity-blocker",
    args: ["--profile", "production"],
    env: jwtEnv({
      DEPLOYMENT_PROFILE: "production",
      ALLOWED_ORIGINS: "https://play.example",
      BIND_ADDR: "0.0.0.0:4107",
    }),
    expectOk: false,
    expectedChecks: [
      "production-persistence-backend-postgres",
      "production-database-url-present",
      "real-account-provider-configured",
      "durable-database-configured",
      "signer-indexer-configured",
      "cross-process-rate-limits-configured",
    ],
    expectedOkChecks: ["real-account-provider-configured"],
  },
  {
    name: "production-postgres-clears-database-blocker",
    args: ["--profile", "production"],
    env: jwtEnv({
      DEPLOYMENT_PROFILE: "production",
      PERSISTENCE_BACKEND: "postgres",
      DATABASE_URL: "postgres://duskfell.example/duskfell",
      ALLOWED_ORIGINS: "https://play.example",
      BIND_ADDR: "0.0.0.0:4107",
    }),
    expectOk: false,
    expectedChecks: [
      "production-persistence-backend-postgres",
      "production-database-url-postgres",
      "durable-database-configured",
      "signer-indexer-configured",
      "cross-process-rate-limits-configured",
    ],
    expectedOkChecks: [
      "real-account-provider-configured",
      "production-persistence-backend-postgres",
      "production-database-url-postgres",
      "durable-database-configured",
    ],
  },
  {
    name: "production-rejects-local-origin",
    args: ["--profile", "production"],
    env: hardenedEnv({
      DEPLOYMENT_PROFILE: "production",
      ALLOWED_ORIGINS: "http://127.0.0.1:4107",
      BIND_ADDR: "0.0.0.0:4107",
    }),
    expectOk: false,
    expectedChecks: ["production-origins-https", "production-origins-nonlocal"],
  },
];

const results = [];

for (const testCase of cases) {
  results.push(await runCase(testCase));
}

const result = {
  ok: results.every((entry) => entry.ok),
  elapsedMs: round(performance.now() - startedAt),
  results,
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}

async function runCase(testCase) {
  const started = performance.now();
  const child = spawn("node", ["scripts/deployment-preflight.js", ...testCase.args], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      ...testCase.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const exit = await new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // Keep parsed null; the result below reports the raw output.
  }

  const expectedChecksPresent = testCase.expectedChecks.every((name) =>
    parsed?.checks?.some((check) => check.name === name),
  );
  const expectedOkChecksPassed = (testCase.expectedOkChecks ?? []).every((name) =>
    parsed?.checks?.some((check) => check.name === name && check.ok === true),
  );
  const ok =
    parsed != null &&
    parsed.ok === testCase.expectOk &&
    (testCase.expectOk ? exit.code === 0 : exit.code !== 0) &&
    expectedChecksPresent &&
    expectedOkChecksPassed;

  return {
    name: testCase.name,
    ok,
    exit,
    parsedOk: parsed?.ok ?? null,
    expectedChecksPresent,
    expectedOkChecksPassed,
    elapsedMs: round(performance.now() - started),
    stderr: stderr.trim(),
  };
}

function jwtEnv(overrides = {}) {
  return hardenedEnv({
    ACCOUNT_AUTH_MODE: "jwt-hs256",
    ACCOUNT_JWT_HS256_SECRET: "account-jwt-preflight-secret",
    ACCOUNT_JWT_ISSUER: "https://identity.example",
    ACCOUNT_JWT_AUDIENCE: "sundermere",
    DEV_ACCOUNT_TOKEN: undefined,
    ...overrides,
  });
}

function hardenedEnv(overrides = {}) {
  const values = {
    DEPLOYMENT_PROFILE: "shared-poc",
    PERSISTENCE_BACKEND: "jsonl",
    PUBLIC_DEPLOYMENT: "true",
    REQUIRE_SESSION: "true",
    REQUIRE_ACCOUNT: "true",
    DEV_ACCOUNT_TOKEN: "account-preflight-token-0001",
    ADMIN_TOKEN: "admin-preflight-token-00001",
    METRICS_TOKEN: "metrics-preflight-token-0001",
    ALLOWED_ORIGINS: "https://play.example",
    BIND_ADDR: "127.0.0.1:4107",
    GIT_SHA: "0123456789abcdef0123456789abcdef01234567",
    DURABLE_SYNC_WRITES: "true",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete values[key];
    }
  }
  return values;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
