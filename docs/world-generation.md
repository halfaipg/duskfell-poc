# World Generation Pipeline

The requirement-by-requirement status and proof receipts are tracked in
`docs/world-generation-evidence.md`.

Status: one-command source-to-review-package generation, deterministic
hydraulic and thermal erosion, contextual drainage,
regional watersheds, playable tributaries, lake outlets, shoreline authority,
canonical high-resolution terrain authority, deterministic settlements/trails,
climate-derived ecology/resources/landmarks, region surveying, coordinated
LODs, season/weather-ready climate authority, independently hashed authority
chunks, an isolated playable-review shard, a package-aware browser workshop with settlement/trail/landmark authoring,
hash-bound authoring replay, fail-closed illustration experiments, and explicit
shard promotion are implemented. Generated packages remain quarantined and
cannot activate themselves.

## One-Command Generation

Synthetic structural proof:

```sh
npm run worldgen -- --id local-proof --size 64x48
```

Terrain Diffusion source:

```sh
TERRAIN_DIFFUSION_API=http://127.0.0.1:18000 \
  npm run worldgen -- \
  --seed 74291 \
  --size 192x128 \
  --model terrain-diffusion-30m \
  --output worlds/generated/duskfell-valley
```

The short model name selects the versioned `xandergos/terrain-diffusion-30m`
source preset, including its MIT repository provenance, region window, scale,
and sampling density. The equivalent explicit recipe is
`worlds/recipes/terrain-diffusion-frontier.json`.

Survey model-backed regions at the recipe's final dimensions before choosing a
coordinate window:

```sh
TERRAIN_DIFFUSION_API=http://127.0.0.1:18000 \
  npm run worldgen:survey -- \
  --origin 256,0 --grid 4x3 --stride 256 \
  --output worlds/surveys/frontier-review
```

The API URL may also be passed with `--api`. It is a runtime location, not
provenance, and is never recorded in the package. Recipes record the source
repository, license, model, geographic window, sampling rate, and supported
scale. The adapter accepts the upstream API's documented integer scales `1`,
`2`, `4`, and `8`; all other values fail validation. `samplesPerTile` controls
the density of canonical terrain authority inside each game tile, while
`scale` selects the Terrain Diffusion world scale without changing the returned
raster dimensions.

Terrain Diffusion requests include the recipe's hidden apron on all four sides.
Priority-flood drainage and D8 accumulation run over that context before the
playable interior is cropped. This limits boundary artifacts and makes the
source snapshot larger than the final canonical authority grid; metadata
records both the apron and exact response hash.

Generation writes atomically through a temporary staging directory. It refuses
existing outputs, paths outside the repository, and live runtime paths under
`server/data`, `client`, or `assets/terrain/worlds`.

Long chunked illustration runs preserve failures as `<output>.rejected`. After
inspection or recovery from a provider interruption, rerun the exact command
with `--resume on`. The CLI reopens the deterministic quarantine workspace,
rebuilds structural authority, and reuses a completed chunk job only when its
recipe-derived request, control hash, dimensions, output bytes, and SHA-256 all
still match. A changed recipe or tampered candidate fails closed instead of
mixing generations.

## Package Contract

Each successful package under `worlds/generated/<world-id>/` contains:

- `recipe.json`: the complete validated `duskfell-world-recipe-v3` input.
  Local compositor recipes pin every source painting by role, repository-relative
  path, and SHA-256. Generation refuses missing or changed inputs, and package
  validation requires the illustration request to carry the identical pin set.
- `source-terrain.bin`: exact Terrain Diffusion binary response, when used.
- `source-terrain.json`: source encoding, dimensions, provenance, and SHA-256.
- `world-bundle-v2.json`: elevation, climate-derived fields, biome weights,
  pre/post erosion authority, erosion delta and hashes, priority-flood flow,
  per-sample water surface/depth/direction/strength, watershed IDs,
  tributaries, water bodies, shoreline edges, normalized visual material-family
  weights, compatibility grids, and deterministic content hash.
- `chunks/index.json` and `chunks/chunk-X-Y.json`: independently hash-pinned
  gameplay authority chunks. Core tiles cover the world exactly once; recorded
  overlap aprons carry matching height, climate, biome, material, and physical
  water samples for seam-safe streaming and refinement.
- `chunks/visual-controls/index.json` and
  `chunks/visual-controls/chunk-X-Y.png`: gameplay-resolution img2img controls
  cropped with the same authority aprons. Each entry records a core crop,
  byte/hash pin, and exact RGB overlap hashes against cardinal neighbors.
- `chunk-visual-controls-review.png`: contact sheet for the chunk controls.
  These are generation inputs, not approved runtime art.
- For `illustration.execution: chunked-v1`, `chunk-illustration/index.json`,
  `chunk-illustration/jobs/chunk-X-Y.json`, and
  `chunk-illustration/candidates/chunk-X-Y.png`: resumable per-control img2img
  requests, exact request/output hashes, provider response provenance, and raw
  candidate images. `chunk-illustration/review.png` exposes every candidate
  before overlap reconciliation and authority restoration.
- `chunks/visual-illustrated/index.json` and its PNGs: accepted gameplay art
  cropped back into the authority chunk/apron contract after semantic gates.
  Promotion and browser streaming use these files, never the controls.
- `server-authority-patch.json`: review-only placement and collision material
  data. It is not an activation script.
- `terrain-detail-authority-patch.json`: review-only runtime resource nodes,
  lifecycle stages, inventories, and decay consumers in target-world units.
- `gameplay-master.png`, `travel-lod.png`, and `world-map-lod.png`: coordinated
  structural previews derived from the same authority bundle.
- `ecology-review.png`: gameplay raster with resource and landmark authority.
- `review-sheet.png`: a visual comparison surface for the three LODs and
  ecology composition.
- `manifest.json`: package state, source, paths, dimensions, and hashes.
- `validation-report.json`: fail-closed gate result and structural metrics.

Packages regenerated from the workshop also contain `authoring-patch.json` and
hash-bound authoring provenance in `manifest.json`. The patch records the exact
source world content hash, dimensions, settlements, connected trail tree,
bridge cells, and landmark compositions.

Model-backed bundles include `duskfell-terrain-authority-v1`: source-resolution
pre-erosion elevation, erosion delta, post-erosion elevation, and water, river,
and snow masks. Coarse fields, server patches, collision compatibility,
previews, and art gates derive from this authority.
The pipeline rejects any coarse height or server-patch drift from it.

Every bundle also includes `duskfell-water-authority-v1` at the canonical
terrain sampling rate. Wet mask, surface height, physical depth, D8 direction,
and flow strength are cropped into each chunk with the same apron. Bridge
routing, client water animation, and server collision consume this authority;
world-map and shoreline masks remain deterministic coarse projections of it.

Every bundle includes `duskfell-material-weights-v1`. Its normalized meadow,
loam, wet-soil, river-bank, beach, scree, cliff, snow, water, road, and
settlement fields derive from the same hydrology, climate, slope, planning,
and biome authority. Chunk aprons preserve the exact vectors. Structural LODs
and the gameplay compositor consume these weights, while hard legacy material
IDs remain only as collision and compatibility fallbacks.

Server height patches use integer fixed-point samples and declare
`vertexHeightPrecision`. Current generated packages use precision `1000`, so
renderer and collision retain the same millielevation data while older worlds
default to precision `1`.

Terrain Diffusion currently supplies elevation and four climate channels. The
adapter preserves the exact model response, applies recipe-pinned hydraulic
erosion over the complete apron-bearing source, then deterministically resolves
depressions with priority-flood drainage and derives D8 flow, accumulation,
water, river candidates, slope, temperature, moisture, rockiness, snow, soil,
vegetation, normalized biome weights, materials, and server-compatible height
grids. It records depression fill depth for inspection. The downstream seed
controls deterministic local derivation; it does not claim to reproduce a
remote model call without the embedded source payload.

Both source types use the same priority-flood D8 core. Recipes record maximum
tributaries, minimum tributary length, watershed outlet aggregation, and the
shoreline threshold. Flow paths become real river/water authority before biome
normalization and material assignment. Every tile carries a regional watershed
ID, inland lakes record a downstream outlet, and every water-to-land tile edge
becomes a deterministic shoreline segment. These records are gameplay
geography, not decorative overlays.

The first planning pass scores settlement suitability from soil, rock, snow,
vegetation, water access, slope, and a seeded tie-breaker. Sites must share a
connected walkable component and satisfy recipe spacing. A bounded A* pass
builds a minimal settlement network, penalizes rock, slope, snow, and water,
records bridge cells, and emits shared settlement/trail pressure fields plus
the same feature data in the server review patch.

The climate pass combines latitude, elevation lapse, prevailing wind,
orographic lift/rain shadow, source precipitation, slope, and distance to water.
It emits bounded temperature, precipitation, soil moisture, relative humidity,
fog potential, wind exposure, and growing-season fields. Climate-zone authority
distinguishes open water, permanent snow, alpine, tundra, marsh, riparian, crag,
boreal woodland, temperate rainforest, temperate woodland, grassland, dry scrub,
and heath. Four deterministic seasonal baselines are declared for future
simulation; dynamic weather fronts are explicitly not yet implemented.

The ecology pass consumes those climate zones and terrain fields.
It finds contiguous habitat regions, floods accessibility from every planned
settlement through recorded bridge crossings, then places recipe-bounded
resource nodes with deterministic ecological quotas and spacing. Tree species,
growth stage, age, health, stock, mycelium decay consumers, and landmark decay
age are emitted in the existing terrain-detail runtime schema. Ancient ruins,
sacred groves, mineral scars, and waystones remain tied to valid settlement
access and minimum spacing.

## World Workshop

The browser workshop can inspect either an approved world or a generated review
package without copying it into runtime assets:

```text
http://127.0.0.1:4111/world-editor.html?package=/worlds/generated/local-proof
```

It renders climate and terrain fields plus a production-painted military
plan-oblique projection at dynamic world dimensions. The package gameplay
raster is warped over authoritative relief instead of being replaced by an
editor-only palette, with toggles for settlement/trail and resource/landmark
authority. The tool selector supports terrain painting, settlement placement,
multi-click trail routing between settlements, four landmark types, and nearest
feature deletion. Placement and export use the package recipe's slope, spacing,
trail-width, bridge, and count contracts. A trail network must remain a
connected tree, and the world must retain two settlements and one landmark.

Generate the default current-package source, edit it, export the authoring
patch, and rebuild a new review package:

```sh
npm run worldgen -- --output worlds/generated/duskfell-valley
npm run worldgen:apply -- \
  --source worlds/generated/duskfell-valley \
  --patch PATCH_PATH \
  --id duskfell-valley-authored-v1
```

`worldgen:apply` verifies the patch's source hash, reconstructs the source
terrain from the recipe or embedded Terrain Diffusion payload, replays bounded
source-resolution elevation/moisture/rockiness/river brush operations, reapplies
planning fields and materials, recomputes ecology and all rasters, records the
patch in the new manifest, validates the package, and writes atomically to a new
review ID. It refuses live runtime paths and never updates the active shard.

Terrain painting records sparse brush operations in the same hash-bound
authoring patch as features. Elevation, moisture, rockiness, and river routing
are editable; temperature, precipitation, humidity, fog, wind, growing season,
snow, vegetation, and final water are inspect-only derived authority. Replay
regenerates hydrology, climate, biome weights, planning, ecology, LODs, and
chunks. Atlas-region brushes are restricted to the protected interior and the
rebuild is accepted only when every authority, field, biome, and material value
on the regional boundary remains identical to the baseline. Elevation edits
that reroute drainage across a regional edge therefore fail closed and require
a future coordinated multi-region regeneration job.

The hydrology layer displays regional catchment boundaries, tributary
centerlines, exact shoreline edges, and lake outlets. Counts in the workshop
come directly from package authority.

## Huge-World Boundary

The 64 by 64 examples are review cells, not a production world-size ceiling.
Huge worlds use a hierarchy:

1. Generate low-resolution continental elevation, climate, and biome envelopes
   from one seed and coordinate system. The implemented atlas command emits
   deterministic region descriptors, parent-authority hashes, precipitation-
   weighted D8 drainage, narrow flow segments, and reciprocal river gates.
2. Refine requested macro regions into fixed-size gameplay chunks with recorded
   overlap aprons. Chunk output depends only on the recipe, coordinates, parent
   authority, and source hashes.
3. Address every chunk by coordinate and SHA-256 through `chunks/index.json`.
   Neighboring apron samples must exactly match authority and validation fails
   on gaps, overlaps, or drift.
4. Stream only active and nearby chunks at runtime. The server must not parse a
   continent-sized gameplay JSON or scan every world tile each tick.

This hierarchy is mandatory even when storage is cheap. A larger world changes
atlas dimensions and the number of independently scheduled region packages; it
does not increase the terrain loaded by one client or simulation process. The
current recipe validator permits up to `128 x 128` regions, while the measured
and visually reviewed reference atlas remains `32 x 24`. Larger atlases require
their own generation-time, storage, transfer, and traversal budgets before
approval; the numeric cap is not a production-readiness claim.

Package generation emits and validates the chunked artifact shape. Promotion
retains the pinned chunk index and files. For a chunked approved world, the
browser opens the verified index, loads the player's initial 3 by 3 window,
assembles terrain at global region coordinates, and keeps a bounded LRU with
in-flight deduplication and movement look-ahead. It does not request the
regional `world-bundle-v2.json`; that verified monolithic fallback remains only
for older non-chunked approvals. Promoted server content also omits duplicate
material and height grids: startup verifies the pinned chunk index, byte bounds,
every chunk SHA-256, core coverage, and shared fixed-point vertices before
assembling one bounded regional authority grid. A hard 262,144-tile regional
ceiling prevents a server process from silently becoming a continent server.
Atlas identity, content hash, region coordinate, global tile origin, and exact
neighbor IDs now survive generation, promotion, Rust validation, snapshots, and
browser parsing. The simulation de-duplicates outward edge pressure into a
server-owned handoff intent with global crossing and safe destination
coordinates. Transfer-ticket primitives and destination admission validation
are implemented and tested. Trusted live transport, source freeze/ack, a shared
durable replay ledger, and dynamic weather fronts remain implementation work.
Standalone promotion is still intended for bounded review shards.

A measured `192 x 128` regional proof generated 24,576 tiles as twenty-four
`32 x 32` authority chunks with four-tile aprons. The validated chunk payloads
were about 4.7 MB. The same proof also exposed a deliberate next boundary: its
three monolithic diagnostic rasters took the total package to about 26 MB and
made the build take about 98 seconds on the development Mac. Production-scale
generation must therefore render gameplay art per chunk and retain only a
bounded continental overview; it must not extrapolate the current global
`gameplay-master.png` approach to an entire world.

The production hierarchy is **continent atlas -> deterministic region ->
streamed gameplay chunk**. `npm run worldgen:atlas` now addresses a
`6144 x 3072`-tile continent as 768 regions and 18,432 possible gameplay
chunks while storing only 12,288 coarse authority samples. The atlas validator
requires a bounded land fraction plus ocean, alpine, crag, woodland, and
dry/open-country authority. Every region descriptor records absolute tile
origin, deterministic seed, neighbors, climate summary, chunk grid, and hashes.

`npm run worldgen:region` validates those hashes, samples the atlas in global
coordinates with a two-sample-per-tile apron, and emits a normal review package
with twenty-four hash-pinned gameplay chunks. Automated neighboring-region
tests prove exact shared source and derived elevation vertices. Continental
priority-flood runoff is hash-bound to the atlas and rasterized from shared flow
segments; reciprocal gate tests prove the inherited channel appears on both
sides of an independently generated boundary. Cubic continental reaches and
sparse client terrain assembly are implemented. Local tributary
curvature/erosion and coordinated cross-region elevation editing remain before
calling the authoring system huge-world complete.
Manifest-v4 packages now emit gameplay-resolution chunk
visual controls with authority aprons, core crop rectangles, image hashes, and
validator-recomputed neighbor overlap hashes. A rehashed image with one altered
overlap pixel still fails validation. Accepted illustrated masters are cropped
into the same apron-bearing contract, revalidated, preserved by promotion, and
streamed by the browser through a separate hash-verifying bounded LRU. The
browser composes only the nearby painted window and does not request the
gameplay monolith; the compact world-map LOD remains a single overview image.
`chunked-v1` now runs img2img independently from each control, reconciles the
aprons inside a bounded region, and assembles gameplay/travel/map outputs
without constructing a continental gameplay master. The server now has bounded regional player-state export/import and
short-lived signed transfer-ticket primitives, but live routing still requires
a trusted endpoint registry, source freeze/ack protocol, and shared durable
replay ledger.

Large selections run through the durable region scheduler instead of one shell
loop:

```sh
npm run worldgen:regions -- \
  --atlas worlds/generated/duskfell-first-continent-atlas-v8 \
  --rect 4,7:3x2 \
  --template worlds/recipes/duskfell-valley.json \
  --output worlds/generated/frontier-batch \
  --concurrency 2 \
  --max-attempts 2
```

`batch.json` pins the atlas manifest/content hashes, template hash, rectangle,
attempt counts, status, and accepted manifest hash for every region. Writes are
atomic. Completed outputs are fully revalidated before resume and are never
rerun; interrupted jobs reopen their region quarantine with `--resume on`.
Concurrency is capped at four and a rectangle at 1,024 jobs so a typo cannot
fan out an unbounded provider workload. Resume refuses atlas, template,
selection, completed-package, or manifest drift.

Workshop patches for atlas regions now replay deterministically
from the embedded, hash-pinned regional source artifact. Settlement, trail, and
landmark edits therefore survive regeneration without requiring the parent
atlas to be mutable or online. Terrain brushes edit the source-resolution
elevation, precipitation, rockiness-delta, or inherited river-pressure raster.
The protected seam and exact post-generation boundary checks keep independent
regional builds composable.

## Approval And Promotion

Promotion is deliberately separate from generation. It requires an accepted
illustrated master plus a human approval file bound to the exact package
manifest, review sheet, and gameplay raster hashes.

Before approval, boot any currently valid generated package as an isolated local
review shard:

```sh
npm run worldgen:preview -- \
  --package worlds/generated/WORLD_ID \
  --port 4112
```

Open the printed URL, which includes `preview=1`. The command revalidates the
package, stages hash-addressed assets and standalone server authority under
`var/world-previews/`, and isolates durable files there. Its registry and runtime
manifest are explicitly `review`; the normal browser loader refuses that state
without the preview opt-in. It never writes `assets/terrain/worlds/`,
`server/data/worlds/`, or the live registry, and it cannot substitute for human
approval.

```sh
npm run worldgen:approval -- \
  --package worlds/generated/WORLD_ID \
  --output worlds/approvals/WORLD_ID.json
```

Inspect the package in the workshop, then complete the pending template. The
real promotion command refuses pending decisions, structural-only packages,
hash drift, altered approval statements, missing camera/art/alignment
acceptance, unsafe paths, duplicate IDs, or invalid packages:

```sh
npm run worldgen:promote -- \
  --package worlds/generated/WORLD_ID \
  --approval worlds/approvals/WORLD_ID.json
```

A successful promotion installs a new immutable directory under
`assets/terrain/worlds/WORLD_ID/`, emits standalone validated server content at
`server/data/worlds/WORLD_ID.json`, transforms ecology coordinates into that
standalone shard, and updates `assets/terrain/worlds/registry.json` last. It
does not overwrite `server/data/world.json` or reuse another shard's durable
state.

Run an approved world locally with isolated content, ecology, journal, and
settlement outbox paths:

```sh
npm run worldgen:serve -- --world WORLD_ID --port 4112
```

Then open `http://127.0.0.1:4112/game.html?world=WORLD_ID`. The browser resolves
the ID through the registry and verifies the approved runtime manifest. Chunked
worlds load the compact world-map raster once, then hash-verify matching nearby
authority and illustrated gameplay windows through independent bounded LRUs;
they do not request the gameplay monolith. This is a local shard workflow; it
does not make the public deployment posture production-ready.

## Illustration Experiments

Illustration is disabled by default in provider-backed recipes. Enable it
explicitly with `--illustration on` only for a reviewed provider/model recipe.
`illustration.execution` is part of recipe provenance:

- `chunked-v1` submits every apron-bearing visual control independently. Each
  deterministic chunk seed, prompt, model knob, input hash, response metadata,
  and output hash lives in a resumable job file. A bounded worker pool skips
  byte-valid completed jobs after interruption. Candidate aprons are feathered
  into one bounded regional candidate before the normal semantic gates run.
- `regional-v1` retains the earlier single-request experiment for comparison
  and for explicit full-region comparison experiments. It must not be used to
  construct a continent-sized gameplay image.

The project-owned authority compositor reads only the `illustration.inputAssets`
declared by its versioned recipe. It verifies each source painting before use;
hard-coded or silently substituted texture files are outside the contract.

Returned regional candidates must pass water/snow overlap, river offset,
route/clearing recall, entropy, and edge-energy gates. Accepted masters restore
continuous water/snow/trail/settlement authority, derive gameplay/travel/map
LODs, and are cropped into exact streamable illustrated chunks. Promotion
retains the complete chunk-job provenance tree. Blender heightfield controls now
render at exact gameplay scale and are cropped into the same apron-bearing
controls before chunk jobs start. The durable atlas-region scheduler can run
many bounded packages without a continent-sized gameplay canvas. A distributed
queue may replace its filesystem state when generation moves off one host; the
hash and retry contract should remain the same.

`FLUX.2 Klein 4B FP8` is currently a rejected full-map illustrator. Live proofs
preserved broad landform structure poorly, invented map labels/interface
elements, and failed the semantic and texture gates. Do not lower thresholds to
admit it. Retain it only as recorded negative evidence while evaluating a
ControlNet/structure-conditioned model. AI remains suitable for local material,
prop, and biome-patch candidates that can be tiled or composed under authority.

## Current Gates

`scripts/worldgen/package-validator.mjs` rejects packages with malformed grids,
out-of-range fields, biome weights outside tolerance, missing water or snow,
discontinuous or implausibly short river centerlines, malformed watershed
coverage, invalid tributaries, missing inland-lake outlets, shoreline drift,
invalid settlement count
or spacing, disconnected/steep trails, unrecorded or overlong bridge crossings,
malformed habitats, inaccessible or overlapping resources/landmarks, lifecycle
or inventory drift, source/recipe/model/input-asset drift, missing or altered source
snapshots, incorrect runtime placement, activation-like server patches, raster
dimension drift, or any recorded hash mismatch.

Tests:

```sh
npm run worldgen:test
```

The test suite includes deterministic synthetic generation, macro-boundary
continuity, recipe rejection, a binary Terrain Diffusion fixture, material-grid
legality, deterministic ecology, authored planning replay, a hash-bound
authoring CLI rebuild, and a complete quarantined CLI build.

## Honest Limitations

The current previews are structural diagnostics, not shippable terrain art.
They expose geography but still use intentionally plain semantic materials,
understated settlement/trail pressure, and limited LOD differentiation.
Drainage fills pits, resolves flats, extracts a contextual major channel and
recipe-bounded tributaries, groups regional watersheds, records lake outlets,
and emits exact shoreline edges. Hydraulic sediment transport and optional
thermal relaxation are implemented before drainage; seasonal flow,
floodplains, deltas, persistent sediment layers, and curved sub-tile shoreline
morphology are not.

The next implementation stages are:

1. Extend the watershed/tributary/lake-outlet pass with Strahler hierarchy,
   seasonal flow, floodplains, deltas, persistent sediment, and coastline cleanup.
2. Expand the implemented climate ecology with succession simulation, seasonal
   pressure, depletion/regrowth, species migration, and economic catchments.
3. Expand the implemented settlement/A* and landmark pass with named regions,
   mountain passes, bridge structures, and road hierarchy.
4. Evaluate a stronger structure-conditioned illustrator per chunk. Exact
   apron-bearing visual controls, Blender control, semantic preflight, drift
   gates, project-owned texture compositor, and accepted-master LOD derivation
   are implemented. Generated chunk cores must still pass boundary checks and
   human review for shorelines, snow, and material-scale variation.
5. Promote a first illustrated gameplay master only after those gates pass.
6. Expand the implemented browser workshop with recipe/seed exploration,
   validation-failure overlays, package comparison, terrain-brush replay, and
   background regeneration jobs.
7. Refine local tributaries with deterministic curvature and bank erosion while
   preserving the implemented cubic continental reaches and reciprocal gates.
8. Expand the implemented immutable promotion workflow with archive/rollback
   tooling before supporting replacement of an existing world ID.

See [TERRAIN-CONSTITUTION.md](TERRAIN-CONSTITUTION.md) for non-negotiable
authority and art rules, and [terrain-system.md](terrain-system.md) for the
existing runtime terrain contract.
