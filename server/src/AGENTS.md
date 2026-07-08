# Server Source Agent Instructions

This directory contains the Rust runtime. Keep subsystem boundaries crisp and
testable.

## Local Rules

- `sim.rs` owns authoritative gameplay simulation. Do not add browser-trusted
  shortcuts here.
- `protocol.rs` is the server/client contract. Update client parsing and tests
  when it changes.
- `session.rs`, `ingress.rs`, and admin/metrics handlers are security-sensitive.
  Review bounds and failure behavior before widening them.
- `settlement.rs`, `journal.rs`, and `persistence.rs` are replay/idempotency
  sensitive. Preserve append-before-handoff behavior and startup validation.
- `content.rs` and `terrain.rs` gate world/asset authority. Keep parsing strict
  and error messages operator-useful.

## Style

- Prefer typed structs/enums over ad hoc strings.
- Keep mutation paths explicit and easy to audit.
- Split modules when a file starts mixing independent responsibilities.
- Add focused Rust tests near the code when behavior is subtle or security
  relevant.
