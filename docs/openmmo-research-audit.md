# OpenMMO Clean-Room Adoption Audit

Checked July 22, 2026 at OpenMMO commit
`f692f9e6899544de155d1cd4872112a039382345`. The quarantined research clone is
outside the Duskfell repository at
`/Users/j/Documents/New project/research/OpenMMO`.

## Decision

OpenMMO is useful architectural research, especially for offline geography,
material splatting, river fields, terrain editing, room-aware building
occlusion, and measured graphics-quality budgets. It is not a drop-in engine,
asset source, or server foundation for Duskfell.

Do not copy OpenMMO code into Duskfell. Its repository license is PolyForm
Noncommercial 1.0.0, which is incompatible with Duskfell's anticipated
commercial and Base/$DUSK use. Do not import its models, textures, music, or
animations as a bundle. Asset provenance is mixed and many files carry
third-party terms independent of the repository license.

The correct use is to turn observed behavior into original Duskfell
requirements, trace algorithms back to permissive primary sources, and build
against Duskfell's existing authority, provenance, review-package, and
promotion contracts.

## What Was Inspected

- Rust workspace: `server`, `shared`, `terrain`, `agent-client`, and
  `tools/terrain-gen`.
- Svelte 5, Three.js, Threlte, WebGPU, TSL shaders, scene layers, managers,
  editor components, tests, and graphics presets under `client`.
- Procedural continents, elevation, hydraulic erosion, priority-flood/D8
  hydrology, rivers, settlements, A* roads, bridges, splatmaps, vegetation,
  tile baking, and world wrapping under `shared/src/worldgen`.
- Character GLBs, animation packs and retargeting, equipment attachment,
  paperdoll UI, housing, multi-floor occlusion, NPC schedules, and the external
  LLM agent client.
- Runtime-security surfaces: Google token verification, WebSocket limits,
  movement queues, passability, proximity checks, SQLite persistence, REST
  editor writes, deployment scripts, and test coverage.
- Asset ledgers under `doc/assets`, Git LFS contents, repository license, and
  the upstream source named by the erosion implementation.

The checkout contains roughly 113,000 lines across Rust, TypeScript, and
Svelte, 107 tracked GLBs, about 50 tracked music files, and a 736 MB public
client asset directory. This is a substantial game prototype, not a small
terrain demo.

## Highest-Value Lessons

### 1. Add an offline physical-relief pass

OpenMMO separates a low-resolution global map from one-meter tile baking. Its
global pass establishes continents, elevation, erosion, rivers, settlements,
and roads before local detail is added. This is the right division of labor.

Duskfell already has the stronger packaging architecture: atlas and regional
generation, overlap aprons, deterministic chunks, priority-flood hydrology,
climate, ecology, hash-pinned visual controls, resumable illustration, and
explicit promotion. The missing visual ingredient is a mature erosion/relief
pass before illustration. Add this to Duskfell authority rather than adopting
OpenMMO's file formats.

OpenMMO's erosion source explicitly says it is a faithful Rust port of
`dandrino/terrain-erosion-3-ways`. The original project is MIT licensed. A
clean-room Duskfell implementation may be derived from that original primary
source with its notice preserved; OpenMMO's noncommercial Rust port must not be
used.

Recommended spike:

1. Add optional hydraulic or stream-power erosion to atlas authority.
2. Preserve the pre-erosion and post-erosion fields in review packages.
3. Recompute D8 flow, watersheds, lakes, tributaries, climate, planning, and
   ecology from the accepted eroded height field.
4. Prove exact regional boundary continuity and deterministic rebuilds.
5. Compare erosion-off and erosion-on worlds in the existing workshop.

### 2. Promote material weights, not hard biome colors

OpenMMO bakes a 64 by 64 per-tile splat field with two material indices, a
blend byte, and vegetation metadata. Its classifier uses explicit precedence
for river bed, road, sea, cliff, alpine, slope, coast, and plain. Neighboring
branches deliberately converge on compatible material pairs to avoid palette
pops.

Duskfell already emits normalized biome weights and material authority. Adopt
the invariant, not the encoding: every gameplay sample should expose stable
material-family weights and transition pressure. The runtime painter and
img2img control compositor should consume those same weights. Roads, river
banks, scree, snowline, wet soil, and shoreline should be modifiers over a
base material family, not unrelated tile replacements.

### 3. Add a river-surface field tied to the carved bed

OpenMMO's strongest rendering idea is its per-tile water field. Surface height
and flow direction are baked on the same 65 by 65 grid as terrain, and the
runtime derives visibility from water-surface minus bed height. Shared geometry
rules keep carving, bank material, bridges, and water coverage aligned.

Duskfell should add an original `waterSurface`, `waterDepth`, and `flowVector`
authority field to each streamed chunk. This would replace offset decorative
water with data-driven river and lake animation while retaining our illustrated
ground. The same authority should drive collision, bridge placement, shoreline
effects, minimap water, and visual masks.

### 4. Make the workshop preview the final material system

OpenMMO's editor is compelling because height, splat, road, zone, NPC, and
object tools operate in the running scene. The useful lesson is immediate
feedback through production rendering.

Do not adopt its direct-write workflow. Its editor persists PUT requests into
live terrain files. Duskfell's hash-bound authoring patches, quarantine
packages, validation, visual approval, and atomic promotion are safer. Extend
the Duskfell workshop so authoring uses the exact runtime material blend,
water field, object composition, shadows, and day/night renderer, then exports
an immutable patch for regeneration.

### 5. Use room-aware occlusion, not whole-building hiding

OpenMMO checks individual room volumes against the camera ray, tracks the
player's effective floor, and controls front walls, back walls, floor meshes,
stairs, doors, and roofs separately. This handles concave buildings and
multiple floors better than a single house rectangle.

Duskfell now has floor-aware room-volume authority, connected floor portals,
and named roof occluder groups. Entering one room reveals its section while
adjacent rooms remain covered; portal transitions can reveal both connected
rooms. Camera-facing wall groups remain a later art/authoring extension. This
stays in the plan-oblique 2.5D renderer and does not require a runtime 3D
conversion.

### 6. Adopt measured quality budgets

OpenMMO records real GPU findings rather than generic optimization advice:
pipeline warmup cost, draw-call reductions, dynamic work counts, alternate-frame
water passes, shadow exclusions, device budgets, and bounded tile work per
frame. Its mobile preset removes grass and expensive water effects while
preserving terrain, trees, housing, and basic water.

Duskfell now defines equivalent named low, balanced, and high budgets. Each
caps DPR, terrain overscan, GPU texture residency, visual-chunk cache entries,
dynamic terrain shadows, water animation, footfall particles, and optional GPU
grass. The HUD reports the active budget beside measured FPS. Painted ground
and sprite vegetation remain the low-cost baseline; GPU grass is high-only.

### 7. Keep agents on the player protocol

OpenMMO's external agent client reconnects through the normal WebSocket
protocol, receives world state, follows schedules, pathfinds, and converts
bounded LLM output into ordinary game actions. LLM calls are scheduled outside
combat and movement loops.

This validates Duskfell's current direction: Animus cognition remains outside
authoritative simulation and emits validated intents through a bounded bridge.
Duskfell now routes player speech, model-backed NPC speech, and deterministic
canned fallback through one typed `ActorIntent` gateway. The simulation checks
actor identity, audience identity, proximity, sanitation, and length at
execution time, so a delayed model response cannot bypass ordinary authority.
Protocol-level NPC load clients, schedule context, and reconnect policy remain
future additions. Do not grant LLM code mutation authority or a privileged
gameplay API.

## What Duskfell Already Does Better

- Commercially usable original-code posture under MIT, with explicit
  clean-room rules.
- Review-only generation directories, exact input/output hashes, source pins,
  rejected-output preservation, authoring-patch replay, validation, approval,
  and atomic world promotion.
- Hierarchical atlas, region, and chunk packages with overlap aprons and seam
  checks instead of a single monolithic 32 km bake.
- Climate authority for temperature, precipitation, humidity, fog potential,
  wind, growing season, biome weights, seasonal baselines, and ecology.
- Server-authoritative ECS tick, interest-filtered snapshots, bounded session
  and settlement channels, admission limits, per-IP/account controls, payload
  caps, origin allowlists, readiness, metrics, durable journals, replay, and
  deployment smokes.
- Runtime asset manifests and fail-closed integrity verification.
- A deliberate low-end target based on illustrated terrain and sprites rather
  than mandatory WebGPU, large GLBs, 4K shadows, real-time reflections, and
  dense blade grass.

## Risks And Rejections

### License and asset risk

- PolyForm Noncommercial applies to the repository code. No OpenMMO code should
  enter Duskfell unless the author grants a separate commercial license.
- Its asset records contain a mixture of Poly Haven, Sketchfab, Mixamo, Meshy,
  Tripo, Civitai, and generated music. Several ledgers provide source links but
  not a complete per-runtime-file license and attribution manifest.
- Mixamo source animation files cannot be redistributed standalone under the
  ordinary Mixamo terms. Generated-service rights depend on account tier and
  generation date. Do not inherit those uncertainties.
- The screenshots reveal a coherent world but also visible style mismatch
  between realistic characters, procedural timber buildings, PBR ground, and
  dense blade grass. Duskfell should borrow composition discipline, not this
  exact art direction.

### Runtime and operational risk

- The WebGPU scene historically incurred approximately 35 to 40 seconds of
  first-load pipeline compilation according to its own loading notes.
- The measured heavy scene remains around 53 to 58 FPS on the documented test
  setup. This is incompatible with Duskfell's "runs on a microwave" baseline
  if adopted wholesale.
- Terrain meshes explicitly disable frustum culling, water retains some
  per-tile textures to avoid stale WebGPU bindings, and the full preset uses
  large shadows and multiple render passes. These are rational local choices,
  not a portable performance foundation.
- Direct player channels use unbounded queues. The broad broadcast stream can
  report lag and skip messages, but the architecture lacks Duskfell's admission
  and bounded-backpressure posture.
- The map editor mutates runtime terrain through authenticated REST writes.
  Authentication is present, but there is no Duskfell-style immutable review
  package and promotion barrier.
- The production deployment script is a single-host pull/build/rsync/restart
  flow. Duskfell's provenance, container, preflight, readiness, drain, and
  post-deploy audit requirements must remain authoritative.
- The checked lockfile could not be tested with Rust/Cargo 1.81 because locked
  `rmp 0.8.15` requires Edition 2024 Cargo support. This is a reproducibility
  mismatch, not evidence that its tests fail.

## Adoption Order

1. **Implemented:** deterministic erosion before climate and illustration.
2. **Implemented:** chunked water surface, depth, and flow authority consumed by
   runtime water and visual controls.
3. **Implemented:** material-family weights through package validation,
   streaming assembly, and runtime ground composition.
4. **Implemented:** production-painted workshop previews that preserve immutable
   authoring patches and promotion.
5. **Implemented:** room-aware multi-floor occlusion and measured low, balanced,
   and high renderer budgets.
6. **Implemented:** one authoritative actor-intent boundary for player speech,
   model-backed NPC speech, and deterministic fallback.
7. **Optional:** use a separate GLB/animation lab only as an authoring source
   for Duskfell's deterministic 3D-to-2D sprite bake. Do not move the runtime to
   full 3D merely because OpenMMO does.

## Primary References

- OpenMMO repository and feature inventory:
  https://github.com/Julian-adv/OpenMMO
- OpenMMO license at the reviewed commit:
  https://github.com/Julian-adv/OpenMMO/blob/f692f9e6899544de155d1cd4872112a039382345/LICENSE
- OpenMMO terrain-generation design:
  https://github.com/Julian-adv/OpenMMO/blob/f692f9e6899544de155d1cd4872112a039382345/doc/TERRAIN_GENERATION.md
- OpenMMO runtime-performance notes:
  https://github.com/Julian-adv/OpenMMO/blob/f692f9e6899544de155d1cd4872112a039382345/doc/RUNTIME_PERFORMANCE.md
- OpenMMO loading notes:
  https://github.com/Julian-adv/OpenMMO/blob/f692f9e6899544de155d1cd4872112a039382345/doc/LOADING_OPTIMIZATION.md
- Original MIT terrain-erosion project named by OpenMMO:
  https://github.com/dandrino/terrain-erosion-3-ways

## Verification Record

- Verified the original Duskfell implementations together after adoption: 159
  server tests, 204 browser-client tests, and 41 world-generation/promotion
  tests pass. Rust formatting and Git whitespace checks also pass.
- Verified a clean shallow checkout with 861 tracked paths and no local
  modifications.
- Inspected repository and asset licenses, docs, manifests, Rust and client
  architecture, implementation files, tests, and screenshots.
- Attempted `cargo test -p onlinerpg-terrain -p onlinerpg-shared --lib`.
  Compilation did not start because local Cargo 1.81 cannot parse the locked
  Edition 2024 dependency manifest. No claim is made that the test suite passes
  or fails on its intended toolchain.
