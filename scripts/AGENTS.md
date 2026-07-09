# Scripts Agent Instructions

Scripts are part of the product's safety and production story. Treat smoke tests,
asset generators, verifiers, and deployment checks as maintained code.

## Read First

- Root `AGENTS.md`.
- `HUMANS.md` for how scripts support the runtime, assets, and deploy gates.
- `docs/security.md` before changing auth, deploy, ops, or public-mode checks.
- `docs/art-pipeline.md` and relevant asset `AGENTS.md` before changing
  generators or manifest verifiers.
- `docs/refactor-map.md` before splitting or expanding script coordinators.

## Rules

- Keep scripts deterministic, bounded, and explicit about failure.
- Prefer structured parsing and clear JSON output for generated artifacts.
- Do not make smoke tests depend on long-lived local state unless that is the
  behavior being tested.
- Keep generator output tied to manifests, provenance, and docs.
- When a script enforces a contract, update the relevant docs and tests in the
  same change.
- Keep deployment/security smokes fail-closed and hostile to placeholder config.

## Cross-Scope Links

- Generator changes usually require manifest/provenance updates, asset README
  updates, runtime verifier checks, and browser review.
- Smoke-test changes usually require the server/client surface they exercise and
  the matching docs command list.
- Shared helper changes under `scripts/lib/` need at least one caller or smoke
  case proving the behavior.

## Tests

- Run the specific script you changed.
- Run dependent smoke tests or verifiers that consume its output.
- For broad script/gate changes, run `npm run verify:local` when feasible.
