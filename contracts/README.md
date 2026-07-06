# Contracts Plan

Contracts are not implemented in this first Duskfell PoC. The first on-chain slice should come after the dry-run settlement flow is durable and tested.

Recommended order:

1. Foundry workspace.
2. OpenZeppelin ERC-721 for a single low-stakes deed-like test asset.
3. Base Sepolia deployment only.
4. Settlement service signs mint/transfer transactions.
5. Ponder indexer writes receipts back to Postgres.
6. Client and sim read indexed app data, never live chain RPC.

Do not start with valuable land deeds. Prove idempotency, replay handling, support tooling, and reconciliation with a low-stakes asset first.

Ticker direction: reserve `$DUSK` for Duskfell on Base, but do not deploy a fungible token until account identity, signer isolation, indexer reconciliation, treasury controls, and legal review are complete.
