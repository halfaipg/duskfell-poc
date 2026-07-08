# Contracts Agent Instructions

Contracts are a reserved boundary for future Base/$DUSK settlement. The current
game must remain playable without chain writes.

## Rules

- Treat contracts as settlement/audit infrastructure, not the game loop.
- Do not imply production token readiness before signer, indexer, replay,
  security, and legal constraints are designed and tested.
- Keep public chain mode fail-closed until production paths exist.
- Keep contract names, events, and metadata original to Duskfell.
- Update server settlement docs and public deployment guards when contract
  assumptions change.
