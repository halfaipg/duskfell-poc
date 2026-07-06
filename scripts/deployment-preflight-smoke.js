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
      "public-deployment-enabled",
      "auth-credentials-distinct",
      "chain-mode-disabled",
      "not-draining",
    ],
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
    name: "production-remains-blocked",
    args: ["--profile", "production"],
    env: hardenedEnv({
      ALLOWED_ORIGINS: "https://play.example",
      BIND_ADDR: "0.0.0.0:4107",
    }),
    expectOk: false,
    expectedChecks: [
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
      ALLOWED_ORIGINS: "https://play.example",
      BIND_ADDR: "0.0.0.0:4107",
    }),
    expectOk: false,
    expectedChecks: [
      "real-account-provider-configured",
      "durable-database-configured",
      "signer-indexer-configured",
      "cross-process-rate-limits-configured",
    ],
    expectedOkChecks: ["real-account-provider-configured"],
  },
  {
    name: "production-rejects-local-origin",
    args: ["--profile", "production"],
    env: hardenedEnv({
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
    PUBLIC_DEPLOYMENT: "true",
    REQUIRE_SESSION: "true",
    REQUIRE_ACCOUNT: "true",
    DEV_ACCOUNT_TOKEN: "account-preflight-token-0001",
    ADMIN_TOKEN: "admin-preflight-token-00001",
    METRICS_TOKEN: "metrics-preflight-token-0001",
    ALLOWED_ORIGINS: "https://play.example",
    BIND_ADDR: "127.0.0.1:4107",
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
