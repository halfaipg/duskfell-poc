# Script Library Agent Instructions

Shared script helpers must be conservative because many smoke tests and gates
depend on them.

## Rules

- Keep helper APIs small and boring.
- Avoid hidden process-wide state.
- Preserve clear error messages for CI and operator debugging.
- Add or update at least one caller/test when changing shared behavior.
- Keep shared helpers free of product-specific optimism. Callers should decide
  whether a failure is fatal, retryable, or expected in a negative smoke case.
- When changing process/server lifecycle helpers, run at least one smoke that
  starts and stops an isolated server.
