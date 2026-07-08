import path from "node:path";

export function summarizeAdminSummary(summary) {
  return {
    tick: summary?.tick,
    players: summary?.players,
    content: summary?.content ?? null,
    publicDeployment: summary?.publicDeployment,
    deploymentProfile: summary?.deploymentProfile,
    persistenceBackend: summary?.persistenceBackend,
    admissionBackend: summary?.admissionBackend,
    requireSession: summary?.requireSession,
    requireAccount: summary?.requireAccount,
    accountAuthMode: summary?.accountAuthMode,
    chainEnabled: summary?.chainEnabled,
    originAllowlistEnabled: summary?.originAllowlistEnabled,
    originAllowedCount: summary?.originAllowedCount,
    journal: {
      events: summary?.journalEvents,
      retainedCapacity: summary?.journalRetainedCapacity,
      replayedTotalEvents: summary?.journalReplayedTotalEvents,
      lastSequence: summary?.journalLastSequence,
      sequenceAnomalies: summary?.journalSequenceAnomalies,
      pathBasename: redactedDurableBasename(summary?.journalPath),
      maxBytes: summary?.maxJournalBytes,
    },
    settlement: {
      pending: summary?.settlementPending,
      confirmed: summary?.settlementConfirmed,
      ownedAssets: summary?.settlementOwnedAssets,
      outboxEvents: summary?.settlementOutboxEvents,
      outboxPathBasename: redactedDurableBasename(summary?.settlementOutboxPath),
      queueCapacity: summary?.settlementQueueCapacity,
      queueMaxCapacity: summary?.settlementQueueMaxCapacity,
      queueFullEvents: summary?.settlementQueueFullEvents,
      queueClosedEvents: summary?.settlementQueueClosedEvents,
      maxOutboxBytes: summary?.maxSettlementOutboxBytes,
    },
    durability: {
      syncWrites: summary?.durableSyncWrites,
      maxLineBytes: summary?.maxDurableLineBytes,
      journalPersistFailures: summary?.durableJournalPersistFailures,
      settlementPersistFailures: summary?.durableSettlementPersistFailures,
    },
    admission: {
      activeConnections: summary?.activeConnections,
      maxActiveConnections: summary?.maxActiveConnections,
      maxConnectionsPerIp: summary?.maxConnectionsPerIp,
      activeConnectionIps: summary?.activeConnectionIps,
      sessionPendingTickets: summary?.sessionPendingTickets,
      sessionTicketCapacity: summary?.sessionTicketCapacity,
    },
    networking: {
      tickBudgetUs: summary?.tickBudgetUs,
      snapshotIntervalMs: summary?.snapshotIntervalMs,
      interestRadiusUnits: summary?.interestRadiusUnits,
      maxSnapshotBytes: summary?.maxSnapshotBytes,
      maxAdminSnapshotBytes: summary?.maxAdminSnapshotBytes,
      websocketHeartbeatSeconds: summary?.websocketHeartbeatSeconds,
      websocketIdleTimeoutSeconds: summary?.websocketIdleTimeoutSeconds,
      websocketMaxTextBytes: summary?.websocketMaxTextBytes,
      websocketMessageBurst: summary?.websocketMessageBurst,
      websocketMessageRefillPerSecond: summary?.websocketMessageRefillPerSecond,
      clientRejectLimit: summary?.clientRejectLimit,
      httpBodyLimitBytes: summary?.httpBodyLimitBytes,
      adminEventLimitCap: summary?.adminEventLimitCap,
    },
    rateLimits: {
      sessionIssueRateLimitPerMinute: summary?.sessionIssueRateLimitPerMinute,
      sessionIssueRateLimitBurst: summary?.sessionIssueRateLimitBurst,
      sessionIssueRateLimitClients: summary?.sessionIssueRateLimitClients,
      sessionIssueRateLimitMaxClients: summary?.sessionIssueRateLimitMaxClients,
      accountSessionRateLimitPerMinute: summary?.accountSessionRateLimitPerMinute,
      accountSessionRateLimitBurst: summary?.accountSessionRateLimitBurst,
      accountSessionRateLimitSubjects: summary?.accountSessionRateLimitSubjects,
      accountSessionRateLimitMaxSubjects: summary?.accountSessionRateLimitMaxSubjects,
    },
  };
}

function redactedDurableBasename(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const basename = path.basename(value);
  if (basename.endsWith("settlement-outbox.jsonl")) return "settlement-outbox.jsonl";
  if (basename.endsWith("journal.jsonl")) return "journal.jsonl";
  return path.extname(basename) === ".jsonl" ? "redacted.jsonl" : "redacted";
}
