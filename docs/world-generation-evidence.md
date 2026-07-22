# World Generation Evidence Ledger

Updated: 2026-07-21

This ledger is the blunt completion audit for the world-generation product. It
separates reproducible evidence from attractive output and future intent. The
detailed operating contract remains in `docs/world-generation.md`.

## Requirement Status

| Requirement | Status | Executable evidence | Remaining boundary |
| --- | --- | --- | --- |
| Seed/size/model to review package | Implemented | `npm run worldgen`; `scripts/worldgen/worldgen.test.mjs`; the `terrain-diffusion-30m` alias resolves and integration-tests the full canonical source preset | A live `TERRAIN_DIFFUSION_API` is still required for real provider output |
| Versioned recipes and provenance | Implemented | `worlds/recipes/`; source bytes, request knobs, model, repository, license, compositor input-asset pins, and SHA-256 checks in package manifests and validation | Provider availability is not reproducibility; embedded source bytes and pinned local inputs are |
| Hydrology | Implemented for bounded regions | Priority flood, D8 flow, watersheds, tributaries, lake outlets, shoreline authority, continental flow segments, and reciprocal gate tests under `scripts/worldgen/` | Local tributary curvature/erosion needs another visual-authoring pass |
| Unified elevation authority | Implemented | Fixed-point vertices flow through package chunks, server startup, movement, browser assembly, seam tests, and atlas neighbor tests | Cross-region elevation edits require coordinated multi-region jobs |
| Climate, biomes, ecology | Implemented as baseline authority | Temperature, precipitation, humidity, wind exposure, seasonal baselines, habitat/resource/landmark composition, and validator tests | Dynamic fronts, storms, and accumulated seasonal state are not implemented |
| Settlements and trails | Implemented | Deterministic placement and A-star planning, slope/water/bridge checks, authoring patches, replay tests, and editor layers | Settlement simulation depth is separate gameplay work |
| Gameplay/travel/map visuals | Implemented as fail-closed review pipeline | Structural or Blender controls, `chunked-v1` jobs, deterministic seeds, resumable hashes, semantic gates, LOD assembly, and chunk visual seam tests | Art quality still requires human browser review; provider output is never auto-approved |
| Huge-world generation | Implemented for atlas to region batch | `worldgen:atlas`, `worldgen:region`, and durable `worldgen:regions`; measured `32 x 24` atlas, 768 regions, and 18,432 possible chunks | Multi-host generation scheduling and storage distribution are not implemented |
| Huge-world client/server loading | Implemented per bounded region | Browser hash-verifies and caches matching 3 by 3 authority/art windows; Rust reconstructs one capped regional authority from chunk pins | Seamless live travel between independently running region shards is not wired |
| Editor and deterministic replay | Implemented | `client/world-editor.*`, source-hash-bound feature/terrain patches, atlas seam guards, and replay tests | Coordinated cross-region terrain brush transactions remain |
| Package to playable review | Implemented | `npm run worldgen:preview -- --package PATH --port PORT`; real Rust/browser boot verified against `var/region-batch-proof/regions/5-7` | Preview is local and deliberately cannot approve or publish a package |
| Human approval and immutable promotion | Implemented | `worldgen:approval`, `worldgen:promote`, `worldgen:serve`, promotion tests, and boot smoke | Public deployment still has the independent security/operations blockers in `docs/security.md` |
| Cross-region player transfer | Primitives only | Bounded player export/import, reciprocal-neighbor validation, signed short-lived tickets, nonce replay rejection, and Rust tests | Trusted endpoint registry, source freeze/ack, live transport, and shared durable replay ledger are required |

## Reference Scale

The checked atlas recipe is `32 x 24` regions. Each region is `192 x 128`
tiles, each gameplay chunk is `32 x 32` tiles, and each tile is 64 world units.
That addresses:

- `6144 x 3072` gameplay tiles;
- 768 independently reproducible regions;
- 18,432 possible gameplay chunks;
- one bounded regional simulation per shard process;
- one nearby 3 by 3 chunk window per client stream.

The atlas recipe validator permits up to `128 x 128` regions. That is a
defensive address-space cap, not evidence that such an atlas meets generation,
storage, CDN, operational, or traversal budgets. Any increase beyond the
reference atlas needs measured receipts before approval.

## Current Proof Receipts

- Literal brief command: `worlds/duskfell-valley/` (local ignored receipt)
- Literal command result: 24,576 tiles, 24 chunks, accepted review manifest,
  embedded `401 x 273` Terrain Diffusion-compatible source and SHA-256
- Literal command playable review: verified through `worldgen:preview` and the
  real browser/Rust path at about 122 FPS with no browser warnings or errors
- Durable region batch: `var/region-batch-proof/batch.json`
- Valid generated region: `var/region-batch-proof/regions/5-7/`
- Region review sheet: `var/region-batch-proof/regions/5-7/review-sheet.png`
- Chunk illustration candidates: `var/chunked-world-proof/chunk-illustration/review.png`
- Streamable illustrated chunks: `var/chunked-world-proof/chunk-visual-illustrated-review.png`
- Blender controls: `var/blender-chunk-control-proof-v2/chunk-visual-controls-review.png`

Generated package directories and files under `var/` are local receipts, not
source-controlled release artifacts. The literal proof used a deterministic
adapter-compatible Terrain Diffusion fixture to exercise the exact HTTP/source
path without claiming those fixture elevations came from the upstream model.
Their durable value comes from the commands, schemas, hash checks, and tests
that reproduce or reject them.

## Definition Of Huge-World Done

Do not call seamless huge-world multiplayer complete until all of these are
true together:

1. Region endpoints are resolved from a trusted atlas-hash-bound registry.
2. The source shard freezes and durably records a transfer before issuing it.
3. The destination verifies, persists, and acknowledges one admission.
4. A shared replay ledger prevents loss or duplication across process crashes.
5. Reconnect and rollback behavior are exercised by process-kill integration tests.
6. Clients cross a boundary without loading a continent or trusting local position.

Until then, Duskfell has continent-scale deterministic generation and bounded
regional play, not seamless continent-scale runtime travel.
