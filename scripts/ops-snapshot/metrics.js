export function parseMetrics(text) {
  const metrics = {};
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+(-?\d+(?:\.\d+)?)$/);
    if (match) metrics[match[1]] = Number(match[2]);
  }
  return metrics;
}

export function summarizeMetrics(metrics) {
  const names = [
    "sundermere_public_deployment",
    "sundermere_deployment_profile_local",
    "sundermere_deployment_profile_shared_poc",
    "sundermere_deployment_profile_production",
    "sundermere_persistence_backend_jsonl",
    "sundermere_persistence_backend_postgres",
    "sundermere_admission_backend_in_memory",
    "sundermere_admission_backend_redis",
    "sundermere_draining",
    "sundermere_require_session",
    "sundermere_require_account",
    "sundermere_chain_enabled",
    "sundermere_origin_allowlist_enabled",
    "sundermere_origin_allowed_origins",
    "sundermere_tick",
    "sundermere_players",
    "sundermere_active_connections",
    "sundermere_max_active_connections",
    "sundermere_ws_connections_total",
    "sundermere_ws_messages_rejected_total",
    "sundermere_ws_capacity_rejected_total",
    "sundermere_ws_peer_capacity_rejected_total",
    "sundermere_ws_snapshot_payload_rejected_total",
    "sundermere_admin_snapshot_payload_rejected_total",
    "sundermere_origin_rejected_total",
    "sundermere_account_auth_rejected_total",
    "sundermere_admin_auth_rejected_total",
    "sundermere_metrics_auth_rejected_total",
    "sundermere_session_ticket_rejected_total",
    "sundermere_session_ticket_capacity_rejected_total",
    "sundermere_session_issue_rate_limited_total",
    "sundermere_session_account_rate_limited_total",
    "sundermere_session_draining_rejected_total",
    "sundermere_session_pending_tickets",
    "sundermere_session_ticket_capacity",
    "sundermere_tick_duration_last_us",
    "sundermere_tick_duration_max_us",
    "sundermere_tick_overruns_total",
    "sundermere_journal_events",
    "sundermere_journal_last_sequence",
    "sundermere_journal_sequence_anomalies",
    "sundermere_settlement_pending_jobs",
    "sundermere_settlement_confirmed_jobs",
    "sundermere_settlement_owned_assets",
    "sundermere_settlement_outbox_events",
    "sundermere_settlement_queue_capacity",
    "sundermere_settlement_queue_full_total",
    "sundermere_settlement_queue_closed_total",
    "sundermere_durable_journal_persist_failed_total",
    "sundermere_durable_settlement_persist_failed_total",
  ];
  return Object.fromEntries(names.map((name) => [name, metrics[name] ?? null]));
}
