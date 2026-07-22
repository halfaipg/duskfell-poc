# Terrain Constitution

Status: implemented for the `valley-v2` review slice and the versioned
source-to-review-package generator. These rules govern every future procedural
world, editor export, illustrated bake, and runtime LOD. See
`docs/world-generation.md` for implemented boundaries and current limitations.

## Authority

1. One versioned world recipe owns seed, dimensions, elevation, hydrology,
   climate, biome fields, splines, and region placement.
2. Gameplay, travel, and world-map imagery derive from the same bundle. A map
   may simplify detail but may not move rivers, lakes, passes, mountains,
   snowlines, trails, or settlements.
3. Server collision is generated from the same material and height grids. A
   review slice may remain client-only, but it must ship a server patch artifact
   and must not be described as authoritative multiplayer terrain until that
   patch is activated during an explicit wipe.
4. Generated art never becomes authority. It enriches a structural control and
   is rejected when semantic alignment gates fail.

## Generation Order

1. Generate coarse continental elevation and climate inputs first. Elevation
   becomes authority only after the erosion pass. Refine
   gameplay regions by coordinate into independently reproducible chunks; never
   require one continent-sized gameplay grid in memory.
   A bounded regional package may include whole-region diagnostic rasters, but
   production continents must use a lightweight atlas overview and chunk-local
   gameplay art. Never scale a whole-region `gameplay-master.png` into a
   continent-sized asset.
2. Run the recipe-pinned deterministic hydraulic erosion pass before drainage,
   climate, biome assignment, or illustration. Preserve pre-erosion elevation,
   post-erosion elevation, delta, algorithm configuration, and input/output
   hashes. Regional iteration radius must fit entirely inside the source apron.
3. Resolve continental drainage envelopes and connected water masks before
   biome assignment, then refine local hydrology with recorded overlap aprons.
   Priority-flood drainage, regional watershed IDs, tributaries, inland-lake
   outlets, and shoreline edges are authority and must remain reproducible.
4. Derive continuous temperature, precipitation, moisture, humidity, fog
   potential, wind exposure, growing season, rockiness, soil, snow,
   disturbance, and vegetation fields.
5. Normalize both biome weights and visual material-family weights at every
   tile. Hard material IDs exist only for collision and compatibility; visual
   transitions consume continuous meadow, loam, wet-soil, bank, beach, scree,
   cliff, snow, water, road, and settlement weights.
6. Render macro controls from global fields. Model-backed crops request a core
   plus recorded apron and resolve drainage before cropping the playable core.
7. Run constrained illustration only after local control preflight. Restore
   exact authority masks where a model changes geography, then run drift gates.
8. Derive all lower LODs from the accepted illustrated master.
9. Add runtime depth using deterministic sprite instances, water animation,
   restrained elevation, shadows, ruins, interactive resource state, and
   climate-driven atmosphere. Fog placement must consume humidity, fog
   potential, wind exposure, elevation, and water pressure from the same world
   package. Local fog may be disabled by the low graphics budget so atmospheric
   work never compromises the painted-terrain baseline.

## Projection And Scale

- Projection is military plan-oblique with square-plan 64 by 64 world tiles.
- Gameplay sprites use bottom-center foot anchors.
- Runtime elevation is intentionally restrained. The current valley maps its
  full normalized heightfield to levels 0 through 2; painted rock faces carry
  additional visual depth without producing black wall wedges.
- World-map scale is exactly 8 pixels per world tile. The 64 by 64 valley sits
  at tile offset `(64, 32)` in the current 192 by 128 review world.

## Art Rules

- Target language: hand-painted, high-fidelity dark medieval RPG terrain;
  broad quiet regions, embedded material detail, restrained color, and no
  visible tile grid.
- Ground paintings contain no baked characters, trees, bushes, buildings, or
  gameplay shadows. Those remain separate anchored sprites or structures.
- Repetition, mirrored biome layouts, hard color bands, grain, blur, and
  one-texture-per-biome tiling are rejection conditions.
- AI candidates remain review assets with prompt, model, hashes, and rejection
  reasons. Clean-room policy applies to every reference and generated output.

## Required Gates

- Deterministic bundle hash for a fixed recipe.
- Deterministic erosion hashes and exact protected-interior overlap agreement.
- Per-chunk water surface, depth, D8 flow direction, and flow strength derived
  from the same canonical elevation and wet mask used by collision and bridges.
- Every biome-weight sample sums to one within tolerance.
- Every material-family sample sums to one within tolerance, and chunk aprons
  preserve the exact family vectors from world authority.
- River continuity and lake connectivity.
- Complete watershed coverage, bounded tributaries, inland-lake outlets, and
  exact shoreline-edge correspondence.
- Exactly-once chunk-core coverage, matching overlap aprons, and hash-pinned
  chunk/index provenance.
- Fixed-point server heights must decode to the same elevation samples used by
  the renderer and generator.
- Snow only on qualifying high country.
- Atlas regions may legitimately contain no snow or no open water; continental
  diversity is validated at atlas scope instead of forcing every region to be
  a miniature all-biome showcase.
- No discontinuity at macro boundaries or aprons.
- Illustrated water and snow semantic overlap plus river-center drift.
- Matching gameplay, travel, and map dimensions and pixels-per-tile metadata.
- Runtime asset hashes, sprite anchors, browser rendering, console errors, and
  representative frame rate.

## Current Commands

```sh
npm run worldgen -- --id local-proof --size 64x48
npm run worldgen:atlas -- --recipe worlds/atlases/duskfell-continent.json --output worlds/generated/ATLAS
npm run worldgen:region -- --atlas worlds/generated/ATLAS --coord 5,7 --output worlds/generated/REGION
npm run worldgen -- --recipe worlds/recipes/terrain-diffusion-frontier.json --api URL
npm run worldgen:survey -- --api URL --origin 256,0 --grid 4x3 --stride 256 --output worlds/surveys/review
npm run worldgen:apply -- --source worlds/generated/SOURCE --patch PATCH --id NEW_WORLD
npm run worldgen:approval -- --package worlds/generated/WORLD --output worlds/approvals/WORLD.json
npm run worldgen:promote -- --package worlds/generated/WORLD --approval worlds/approvals/WORLD.json
npm run worldgen:serve -- --world WORLD --port 4112
npm run worldgen:test
npm run terrain:world:v2
npm run terrain:world:v2:test
npm run terrain:world:v2:validate-art
npm run sprites:verify
npm run test:client
```

Review surfaces:

- `/game.html?world=valley-v2&dayTint=day`
- `/world-editor.html`

The editor supports package loading, local field painting, direct river-spline
editing with live water-mask recomputation, settlement/trail/landmark authoring,
ecology overlays, reset, bundle export, and source-hash-bound feature-patch
export. `worldgen:apply` replays those authored records through planning,
ecology, LOD generation, provenance, and package validation under a new review
ID. Synthetic-source elevation, moisture, rockiness, and river strokes now
replay through hydrology, climate, ecology, LOD, and chunk regeneration.
Terrain Diffusion and atlas-region strokes now replay against source-resolution
rasters. Atlas edits must remain inside the protected interior and pass exact
post-generation boundary checks; drainage-changing edits that cross a region
boundary require a future coordinated job. Server region/chunk routing, dynamic
weather, and validation overlays remain follow-up work. Atlas-bound neighboring region
generation now preserves exact shared elevation vertices and inherits
continental flow through reciprocal gates. Promotion retains hash-pinned chunk
files. Chunked approved worlds skip the regional monolithic bundle, assemble a
hash-verified moving terrain window at global coordinates, and prefetch through
a bounded cache. Whole-world
illustration stays disabled until a model passes the recorded semantic and
quality gates. Explicit promotion and isolated standalone shard startup are
implemented, but the real CLI refuses packages without an accepted illustrated
master and hash-bound human review.
