# World Promotion Agent Instructions

This directory owns the only approved bridge from quarantined world packages to
runtime assets and standalone shard content. Read the root and `scripts/AGENTS.md`,
plus `docs/world-generation.md`, before editing here.

## Invariants

- Promotion must validate the source package again immediately before copying.
- Human approval is hash-bound to the package manifest, review sheet, and
  gameplay raster. Never infer approval from a filename, chat message, or
  generated validation report.
- The production CLI requires an accepted illustrated master. Structural-only
  promotion is reserved for isolated automated boot tests.
- Install into a new world ID. Do not overwrite an existing runtime world or
  the default shard.
- Write the runtime registry last so a partial copy cannot become discoverable.
- Keep world content, terrain-detail authority, journal, and settlement outbox
  isolated under the same world ID.
- Do not weaken clean-room, camera, art-direction, or authority-alignment gates
  to get a candidate promoted.

## Verification

- Run `npm run worldgen:test` after changing promotion contracts.
- Run `npm run smoke:world-promotion` after changing emitted server content,
  runtime authority, startup paths, or registry behavior.
- Run `cargo test -p sundermere-server` after changing Rust runtime paths.
