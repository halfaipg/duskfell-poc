# Server Agent Instructions

The server owns Duskfell reality. Shared or public mode must fail closed when
critical safety configuration is missing.

## Read First

- Root `AGENTS.md`.
- `docs/architecture.md` for runtime shape.
- `docs/security.md` for auth, clean-room, deployment, durable replay, and public
  guardrails.
- `docs/terrain-system.md` before changing terrain authority.
- `docs/art-pipeline.md` before changing runtime asset verification.

## Rules

- Keep movement, collision, inventory, resources, crafting, deeds, decay,
  ownership, and settlement under server authority.
- Accept client input intent only.
- Bound all external input by size, rate, identity, and schema before mutation.
- Keep admin/debug/metrics surfaces authenticated when configured and safe in
  public mode.
- Keep settlement asynchronous and idempotent. Never block simulation ticks on
  chain, signer, indexer, durable append pressure, or worker handoff.
- Keep durable JSONL replay bounded and strict while JSONL remains the PoC store.
- Update protocol docs/tests when wire shapes change.

## Tests

- Run `cargo test -p sundermere-server` for server changes.
- Run the relevant smoke under `scripts/` when touching auth, deployment,
  sessions, WebSocket ingress, settlement, durability, content, assets, or
  readiness.
