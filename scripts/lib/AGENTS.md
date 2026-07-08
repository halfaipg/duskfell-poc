# Script Library Agent Instructions

Shared script helpers must be conservative because many smoke tests and gates
depend on them.

## Rules

- Keep helper APIs small and boring.
- Avoid hidden process-wide state.
- Preserve clear error messages for CI and operator debugging.
- Add or update at least one caller/test when changing shared behavior.
