export function jwtEnv(overrides = {}) {
  return hardenedEnv({
    ACCOUNT_AUTH_MODE: "jwt-hs256",
    ACCOUNT_JWT_HS256_SECRET: "account-jwt-preflight-secret",
    ACCOUNT_JWT_ISSUER: "https://identity.example",
    ACCOUNT_JWT_AUDIENCE: "sundermere",
    DEV_ACCOUNT_TOKEN: undefined,
    ...overrides,
  });
}

export function hardenedEnv(overrides = {}) {
  const values = {
    DEPLOYMENT_PROFILE: "shared-poc",
    PERSISTENCE_BACKEND: "jsonl",
    ADMISSION_BACKEND: "in-memory",
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
