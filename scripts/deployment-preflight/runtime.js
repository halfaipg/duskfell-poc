export function checkKnownProfile({ profile, add }) {
  add("profile-known", true, "error", `profile=${profile}`);
}

export function checkDeploymentProfile({ env, profile, add }) {
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

export function checkPersistenceBackend({ env, profile, add }) {
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

export function checkAdmissionBackend({ env, profile, add, hasValidRedisUrl }) {
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

export function checkPublicMode({ env, profile, add }) {
  if (profile === "local") {
    add(
      "local-public-deployment-disabled",
      boolEnv(env, "PUBLIC_DEPLOYMENT") !== true,
      "warn",
      "local profile should normally leave PUBLIC_DEPLOYMENT unset",
    );
    return;
  }

  add(
    "public-deployment-enabled",
    boolEnv(env, "PUBLIC_DEPLOYMENT") === true,
    "error",
    "shared and production profiles require PUBLIC_DEPLOYMENT=true",
  );
  add(
    "session-required",
    boolEnv(env, "REQUIRE_SESSION") === true,
    "error",
    "shared and production profiles require REQUIRE_SESSION=true",
  );
  add(
    "account-gate-required",
    boolEnv(env, "REQUIRE_ACCOUNT") === true,
    "error",
    "shared and production profiles require REQUIRE_ACCOUNT=true",
  );
}

export function checkBuildProvenance({ env, profile, add }) {
  const maxGitShaBytes = 64;
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
    typeof gitSha === "string" && Buffer.byteLength(gitSha) <= maxGitShaBytes,
    "error",
    `GIT_SHA must be at most ${maxGitShaBytes} bytes`,
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

export function checkDurabilityMode({ env, profile, add }) {
  const value = env.DURABLE_SYNC_WRITES;
  const enabled = boolEnv(env, "DURABLE_SYNC_WRITES") === true;
  const journalPath = env.JOURNAL_PATH ?? "var/journal.jsonl";
  const settlementOutboxPath = env.SETTLEMENT_OUTBOX_PATH ?? "var/settlement-outbox.jsonl";
  add(
    "durable-sync-writes-boolean",
    value == null || boolEnv(env, "DURABLE_SYNC_WRITES") != null,
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

export function checkDrainMode({ args, env, profile, add }) {
  const value = env.DRAINING;
  const draining = boolEnv(env, "DRAINING");
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

export function boolEnv(env, name) {
  const value = env[name];
  if (value == null) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}
