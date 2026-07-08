# Scripts Agent Instructions

Scripts are part of the product's safety and production story. Treat smoke tests,
asset generators, verifiers, and deployment checks as maintained code.

## Rules

- Keep scripts deterministic, bounded, and explicit about failure.
- Prefer structured parsing and clear JSON output for generated artifacts.
- Do not make smoke tests depend on long-lived local state unless that is the
  behavior being tested.
- Keep generator output tied to manifests, provenance, and docs.
- When a script enforces a contract, update the relevant docs and tests in the
  same change.
- Keep deployment/security smokes fail-closed and hostile to placeholder config.

## Tests

- Run the specific script you changed.
- Run dependent smoke tests or verifiers that consume its output.
- For broad script/gate changes, run `npm run verify:local` when feasible.
