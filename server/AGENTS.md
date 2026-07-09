# Server Agent Instructions

The server owns Duskfell reality. Shared or public mode must fail closed when
critical safety configuration is missing.

## Read First

- Root `AGENTS.md`.
- `HUMANS.md` for the end-to-end system map and change recipes.
- `docs/architecture.md` for runtime shape.
- `docs/security.md` for auth, clean-room, deployment, durable replay, and public
  guardrails.
- `docs/terrain-system.md` before changing terrain authority.
- `docs/art-pipeline.md` before changing runtime asset verification.

## Cross-Scope Links

- Protocol changes usually require `client/server-message-*.js`, client tests,
  and docs updates.
- Runtime asset verification changes usually require `assets/AGENTS.md`,
  `scripts/AGENTS.md`, manifests, and asset verifier updates.
- Simulation changes that expose new snapshot state usually require browser
  rendering/UI updates and smoke coverage for the gameplay loop.
- Deployment, auth, metrics, readiness, and admin changes usually require a
  matching smoke script or deployment preflight assertion.
- Settlement or chain-boundary changes usually require `contracts/AGENTS.md` and
  an explicit note that gameplay must not block on chain settlement.

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
