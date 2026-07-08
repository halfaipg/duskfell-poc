export function summarizePosture(summary, metrics) {
  const originAllowlistEnabled =
    summary?.originAllowlistEnabled === true && Number(summary?.originAllowedCount ?? 0) > 0;
  const sessionTicketCapacityAvailable =
    Number.isFinite(summary?.sessionPendingTickets) &&
    Number.isFinite(summary?.sessionTicketCapacity) &&
    summary.sessionPendingTickets < summary.sessionTicketCapacity;
  const connectionCapacityAvailable =
    Number.isFinite(summary?.activeConnections) &&
    Number.isFinite(summary?.maxActiveConnections) &&
    summary.activeConnections < summary.maxActiveConnections;
  const durablePersistenceHealthy =
    metrics.sundermere_durable_journal_persist_failed_total === 0 &&
    metrics.sundermere_durable_settlement_persist_failed_total === 0;
  const settlementQueueHasCapacity = metrics.sundermere_settlement_queue_capacity > 0;

  return {
    publicDeployment: summary?.publicDeployment === true,
    deploymentProfile: summary?.deploymentProfile ?? null,
    persistenceBackend: summary?.persistenceBackend ?? null,
    admissionBackend: summary?.admissionBackend ?? null,
    requireSession: summary?.requireSession === true,
    requireAccount: summary?.requireAccount === true,
    originAllowlistEnabled,
    notDraining: summary?.draining === false,
    chainStubDisabled: summary?.chainEnabled === false,
    sessionTicketCapacityAvailable,
    connectionCapacityAvailable,
    durablePersistenceHealthy,
    settlementQueueHasCapacity,
  };
}

export function summarizeEvents(events, requestedLimit) {
  const list = Array.isArray(events) ? events : [];
  const byType = {};
  let latestSequence = 0;
  let latestTick = 0;
  for (const event of list) {
    const type = event?.kind?.type ?? "unknown";
    byType[type] = (byType[type] ?? 0) + 1;
    latestSequence = Math.max(latestSequence, Number(event?.sequence ?? 0));
    latestTick = Math.max(latestTick, Number(event?.tick ?? 0));
  }
  return {
    requestedLimit,
    returned: list.length,
    latestSequence,
    latestTick,
    byType,
  };
}

export function summarizeOwnership(receipts) {
  const list = Array.isArray(receipts) ? receipts : [];
  const byStatus = {};
  let chainTxPresent = 0;
  let accountSubjectPresent = 0;
  for (const receipt of list) {
    const status = receipt?.status ?? "unknown";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (receipt?.chainTx) chainTxPresent += 1;
    if (receipt?.accountSubject) accountSubjectPresent += 1;
  }
  return {
    count: list.length,
    byStatus,
    chainTxPresent,
    accountSubjectPresent,
  };
}
