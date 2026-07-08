export function checkRuntimePosture(context, runtime, summary) {
  if (!summary) return;
  if (context.profile === "shared-poc") {
    context.add(
      "deployment-profile-shared-poc",
      summary.deploymentProfile === "shared-poc",
      `deploymentProfile=${summary.deploymentProfile}`,
    );
    context.add(
      "persistence-backend-jsonl",
      summary.persistenceBackend === "jsonl",
      `persistenceBackend=${summary.persistenceBackend}`,
    );
    context.add(
      "admission-backend-in-memory",
      summary.admissionBackend === "in-memory",
      `admissionBackend=${summary.admissionBackend}`,
    );
    context.add("public-deployment-enabled", summary.publicDeployment === true, `publicDeployment=${summary.publicDeployment}`);
    context.add("not-draining", summary.draining === false, `draining=${summary.draining}`);
    context.add("strict-session-required", summary.requireSession === true, `requireSession=${summary.requireSession}`);
    context.add("account-gate-required", summary.requireAccount === true, `requireAccount=${summary.requireAccount}`);
    context.add("chain-stub-disabled", summary.chainEnabled === false, `chainEnabled=${summary.chainEnabled}`);
    context.add("durable-sync-writes-enabled", summary.durableSyncWrites === true, `durableSyncWrites=${summary.durableSyncWrites}`);
    context.add(
      "origin-allowlist-enabled",
      summary.originAllowlistEnabled === true && summary.originAllowedCount > 0,
      `enabled=${summary.originAllowlistEnabled} count=${summary.originAllowedCount}`,
    );
    context.add(
      "session-ticket-capacity-available",
      Number.isFinite(summary.sessionPendingTickets) &&
        Number.isFinite(summary.sessionTicketCapacity) &&
        summary.sessionPendingTickets < summary.sessionTicketCapacity,
      `pending=${summary.sessionPendingTickets} capacity=${summary.sessionTicketCapacity}`,
    );
    context.add(
      "connection-capacity-available",
      Number.isFinite(summary.activeConnections) &&
        Number.isFinite(summary.maxActiveConnections) &&
        summary.activeConnections < summary.maxActiveConnections,
      `active=${summary.activeConnections} max=${summary.maxActiveConnections}`,
    );
    context.add(
      "account-connection-capacity-available",
      Number.isFinite(summary.activeConnectionAccounts) &&
        Number.isFinite(summary.maxConnectionsPerAccount) &&
        summary.activeConnectionAccounts < summary.maxConnectionsPerAccount,
      `activeAccounts=${summary.activeConnectionAccounts} maxPerAccount=${summary.maxConnectionsPerAccount}`,
    );
  }
  if (runtime && summary.content) {
    context.add(
      "runtime-content-matches-summary",
      runtime.content?.contentHash === summary.content.contentHash &&
        runtime.content?.objectCount === summary.content.objectCount,
      `runtime=${runtime.content?.contentHash ?? "?"} summary=${summary.content.contentHash ?? "?"}`,
    );
  }
}

export function checkMetricsPosture(context, metrics) {
  if (!metrics) return;
  if (context.profile === "shared-poc") {
    context.add(
      "metrics-deployment-profile-shared-poc",
      metrics.sundermere_deployment_profile_local === 0 &&
        metrics.sundermere_deployment_profile_shared_poc === 1 &&
        metrics.sundermere_deployment_profile_production === 0,
      `local=${metrics.sundermere_deployment_profile_local} shared=${metrics.sundermere_deployment_profile_shared_poc} production=${metrics.sundermere_deployment_profile_production}`,
    );
    context.add(
      "metrics-persistence-backend-jsonl",
      metrics.sundermere_persistence_backend_jsonl === 1 &&
        metrics.sundermere_persistence_backend_postgres === 0,
      `jsonl=${metrics.sundermere_persistence_backend_jsonl} postgres=${metrics.sundermere_persistence_backend_postgres}`,
    );
    context.add(
      "metrics-admission-backend-in-memory",
      metrics.sundermere_admission_backend_in_memory === 1 &&
        metrics.sundermere_admission_backend_redis === 0,
      `inMemory=${metrics.sundermere_admission_backend_in_memory} redis=${metrics.sundermere_admission_backend_redis}`,
    );
    context.add("metrics-public-deployment", metrics.sundermere_public_deployment === 1, `value=${metrics.sundermere_public_deployment}`);
    context.add("metrics-not-draining", metrics.sundermere_draining === 0, `value=${metrics.sundermere_draining}`);
    context.add("metrics-require-session", metrics.sundermere_require_session === 1, `value=${metrics.sundermere_require_session}`);
    context.add("metrics-require-account", metrics.sundermere_require_account === 1, `value=${metrics.sundermere_require_account}`);
    context.add("metrics-chain-disabled", metrics.sundermere_chain_enabled === 0, `value=${metrics.sundermere_chain_enabled}`);
    context.add("metrics-durable-sync-writes", metrics.sundermere_durable_sync_writes === 1, `value=${metrics.sundermere_durable_sync_writes}`);
    context.add(
      "metrics-origin-allowlist-enabled",
      metrics.sundermere_origin_allowlist_enabled === 1 &&
        metrics.sundermere_origin_allowed_origins > 0,
      `enabled=${metrics.sundermere_origin_allowlist_enabled} count=${metrics.sundermere_origin_allowed_origins}`,
    );
    context.add(
      "metrics-session-ticket-capacity-available",
      metrics.sundermere_session_pending_tickets < metrics.sundermere_session_ticket_capacity,
      `pending=${metrics.sundermere_session_pending_tickets} capacity=${metrics.sundermere_session_ticket_capacity}`,
    );
    context.add(
      "metrics-connection-capacity-available",
      metrics.sundermere_active_connections < metrics.sundermere_max_active_connections,
      `active=${metrics.sundermere_active_connections} max=${metrics.sundermere_max_active_connections}`,
    );
    context.add(
      "metrics-account-connection-capacity-available",
      metrics.sundermere_active_connection_accounts < metrics.sundermere_max_connections_per_account,
      `activeAccounts=${metrics.sundermere_active_connection_accounts} maxPerAccount=${metrics.sundermere_max_connections_per_account}`,
    );
  }
  context.add(
    "durable-persistence-healthy",
    metrics.sundermere_durable_journal_persist_failed_total === 0 &&
      metrics.sundermere_durable_settlement_persist_failed_total === 0,
    `journalFailures=${metrics.sundermere_durable_journal_persist_failed_total} settlementFailures=${metrics.sundermere_durable_settlement_persist_failed_total}`,
  );
  context.add(
    "settlement-queue-has-capacity",
    metrics.sundermere_settlement_queue_capacity > 0,
    `capacity=${metrics.sundermere_settlement_queue_capacity}/${metrics.sundermere_settlement_queue_max_capacity}`,
  );
}
