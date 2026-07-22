# World Generation Agent Instructions

This directory owns the reproducible world-generation command, recipe contract,
package validation, and source adapters. Read the root and `scripts/AGENTS.md`
before editing here, plus `docs/TERRAIN-CONSTITUTION.md`.

## Invariants

- Generation must be deterministic for a fixed recipe and fixed source data.
- Never write directly to `server/data/world.json` or approved runtime assets.
- Generate into a review package and require a separate, explicit promotion.
- A source label must name the source actually used. Never describe fallback
  noise as Terrain Diffusion output.
- Every package carries its recipe, source provenance, hashes, validation
  report, server authority patch, and coordinated gameplay/travel/map LODs.
- Climate fields derive from terrain, latitude, water, and prevailing wind;
  ecology consumes climate authority instead of inventing independent biomes.
- Huge-world output is chunked. Core coverage must be exact, overlap aprons
  must match bundle authority, and every chunk must be hash-pinned by the index.
- Atlas-bound regions must validate the parent manifest, atlas content,
  descriptor, and parent-authority hashes before generation. Sample local detail
  in global coordinates and use atlas-wide normalization so neighboring region
  heights remain exact. Never describe regional drainage as continent-coherent
  until outlet propagation and neighbor river gates are implemented.
- Fail closed on malformed recipes, existing output, missing tools, hash drift,
  invalid grids, non-normalized biome weights, or semantic gate failures.
- Keep network-backed source adapters mockable. Tests must not require a GPU,
  external API, secret, or mutable long-lived service.

## Verification

- Run `npm run worldgen:test` after changing this directory.
- Generate at least one quarantined example for CLI or package changes.
- Inspect the generated contact sheet before describing visual output as good.
