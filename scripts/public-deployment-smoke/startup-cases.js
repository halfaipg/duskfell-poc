import { expectStartupFailure } from "./server.js";

export async function runStartupGuards(context) {
  const hardenedEnv = {
    DEPLOYMENT_PROFILE: "shared-poc",
    PUBLIC_DEPLOYMENT: "true",
    REQUIRE_SESSION: "true",
    REQUIRE_ACCOUNT: "true",
    DEV_ACCOUNT_TOKEN: context.accountToken,
    ADMIN_TOKEN: context.adminToken,
    METRICS_TOKEN: context.metricsToken,
    ALLOWED_ORIGINS: context.allowedOrigin,
    DURABLE_SYNC_WRITES: "true",
  };

  return {
    missingDeploymentProfileStartup: await expectStartupFailure(
      context,
      {
        PUBLIC_DEPLOYMENT: "true",
      },
      ["DEPLOYMENT_PROFILE=shared-poc"],
    ),
    missingPersistenceBackendStartup: await expectStartupFailure(context, hardenedEnv, [
      "PERSISTENCE_BACKEND=jsonl",
    ]),
    missingAdmissionBackendStartup: await expectStartupFailure(
      context,
      {
        ...hardenedEnv,
        PERSISTENCE_BACKEND: "jsonl",
      },
      ["ADMISSION_BACKEND=in-memory"],
    ),
    refusedStartup: await expectStartupFailure(context, {
      DEPLOYMENT_PROFILE: "shared-poc",
      PUBLIC_DEPLOYMENT: "true",
    }),
    weakTokenStartup: await expectStartupFailure(
      context,
      {
        DEPLOYMENT_PROFILE: "shared-poc",
        PUBLIC_DEPLOYMENT: "true",
        REQUIRE_SESSION: "true",
        REQUIRE_ACCOUNT: "true",
        DEV_ACCOUNT_TOKEN: "short-account",
        ADMIN_TOKEN: "short-admin",
        METRICS_TOKEN: "short-metrics",
        ALLOWED_ORIGINS: context.allowedOrigin,
      },
      ["DEV_ACCOUNT_TOKEN length", "ADMIN_TOKEN length", "METRICS_TOKEN length"],
    ),
    placeholderTokenStartup: await expectStartupFailure(
      context,
      {
        DEPLOYMENT_PROFILE: "shared-poc",
        PUBLIC_DEPLOYMENT: "true",
        REQUIRE_SESSION: "true",
        REQUIRE_ACCOUNT: "true",
        DEV_ACCOUNT_TOKEN: "replace-with-strong-account-token",
        ADMIN_TOKEN: "replace-with-strong-admin-token",
        METRICS_TOKEN: "metrics-token-placeholder-123",
        ALLOWED_ORIGINS: context.allowedOrigin,
      },
      [
        "DEV_ACCOUNT_TOKEN must not use placeholder text",
        "ADMIN_TOKEN must not use placeholder text",
        "METRICS_TOKEN must not use placeholder text",
      ],
    ),
    oversizedTokenStartup: await expectStartupFailure(
      context,
      {
        DEPLOYMENT_PROFILE: "shared-poc",
        PUBLIC_DEPLOYMENT: "true",
        REQUIRE_SESSION: "true",
        REQUIRE_ACCOUNT: "true",
        DEV_ACCOUNT_TOKEN: "a".repeat(4097),
        ADMIN_TOKEN: "b".repeat(4097),
        METRICS_TOKEN: "c".repeat(4097),
        ALLOWED_ORIGINS: context.allowedOrigin,
      },
      [
        "DEV_ACCOUNT_TOKEN length <= 4096 bytes",
        "ADMIN_TOKEN length <= 4096 bytes",
        "METRICS_TOKEN length <= 4096 bytes",
      ],
    ),
    unsyncedDurableStartup: await expectStartupFailure(
      context,
      {
        DEPLOYMENT_PROFILE: "shared-poc",
        PUBLIC_DEPLOYMENT: "true",
        REQUIRE_SESSION: "true",
        REQUIRE_ACCOUNT: "true",
        DEV_ACCOUNT_TOKEN: context.accountToken,
        ADMIN_TOKEN: context.adminToken,
        METRICS_TOKEN: context.metricsToken,
        ALLOWED_ORIGINS: context.allowedOrigin,
        DURABLE_SYNC_WRITES: "false",
      },
      ["DURABLE_SYNC_WRITES=true"],
    ),
  };
}
