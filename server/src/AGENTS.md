# Server Source Agent Instructions

This directory contains the Rust runtime. Keep subsystem boundaries crisp and
testable.

## Local Rules

- `main.rs` should stay an entry point: tracing, runtime initialization, tick
  loop spawn, router construction, listener bind, graceful shutdown.
- `runtime.rs` should stay runtime assembly: env/config validation, durable
  state setup, content/assets loading, settlement worker wiring, sim creation,
  and shared `AppState` construction.
- `sim.rs` owns authoritative gameplay simulation coordination. Gameplay leaf
  behavior belongs in `sim/*` modules when it has a clear boundary.
- `protocol.rs` is the server/client contract. Update client parsing, tests, and
  docs when it changes.
- `session.rs`, `ingress.rs`, and admin/metrics handlers are security-sensitive.
  Review bounds and failure behavior before widening them.
- `settlement.rs`, `journal.rs`, and `persistence.rs` are replay/idempotency
  sensitive. Preserve append-before-handoff behavior and startup validation.
- `content.rs` and `terrain.rs` gate world/asset authority. Keep parsing strict
  and error messages operator-useful.
- `ws/*` owns socket lifecycle, ingress rejection, heartbeat/idle behavior, and
  snapshot sending. Keep player spawn/removal and permit release balanced.
- `runtime_assets/*` owns manifest/image verification. Keep hash checks and byte
  budgets server-side even when the browser also verifies images.

## Style

- Prefer typed structs/enums over ad hoc strings.
- Keep mutation paths explicit and easy to audit.
- Split modules when a file starts mixing independent responsibilities.
- Add focused Rust tests near the code when behavior is subtle or security
  relevant.
