# Duskfell World Recipes

Versioned inputs live in `recipes/`. Run `npm run worldgen -- --recipe PATH` to
produce a quarantined package under `worlds/generated/`.

Continental inputs live in `atlases/`. They describe coarse global elevation,
climate, biome, region, and chunk geometry without materializing every gameplay
tile. Generate and validate an atlas, then refine one hash-bound region:

```sh
npm run worldgen:atlas -- \
  --recipe worlds/atlases/duskfell-continent.json \
  --output worlds/generated/duskfell-first-continent-atlas

npm run worldgen:region -- \
  --atlas worlds/generated/duskfell-first-continent-atlas \
  --coord 5,7 \
  --output worlds/generated/duskfell-first-continent-r5-7
```

The current atlas contract addresses a `6144 x 3072`-tile continent as 768
`192 x 128` regions and 18,432 `32 x 32` gameplay chunks. Region recipes bind
to the exact atlas manifest, atlas content, descriptor, and parent-authority
hashes. Global-coordinate sampling plus atlas-wide normalization gives adjacent
regions exact shared elevation vertices. Continental precipitation-weighted
drainage, flow segments, and reciprocal regional river gates are
implemented and tested. Atlas-region feature patches replay from the embedded
source artifact. Source-resolution terrain brushes replay with protected seam
aprons and exact boundary validation. Durable bounded region scheduling and
chunk-local art jobs are implemented. Coordinated cross-region elevation edits
and trusted live server-to-server routing remain.

`recipes/duskfell-valley.json` is the local deterministic structural source.
`recipes/duskfell-textured-valley.json` additionally pins every project-owned
compositor painting by role, safe repository-relative path, and SHA-256. The
compositor and package validator fail closed if those inputs drift.
`recipes/terrain-diffusion-frontier.json` uses the MIT-licensed
`xandergos/terrain-diffusion-30m` source through `--api URL` or the
`TERRAIN_DIFFUSION_API` environment variable. Model-backed packages embed and
hash the exact source response so they remain reproducible if the remote source
later changes or disappears. Region surveys are written under `surveys/` by
`npm run worldgen:survey`; they use the recipe's final dimensions and contextual
apron and are also ignored by Git.

The canonical model-backed review command is:

```sh
TERRAIN_DIFFUSION_API=http://127.0.0.1:18000 \
  npm run worldgen -- \
  --seed 74291 \
  --size 192x128 \
  --model terrain-diffusion-30m \
  --output worlds/generated/duskfell-valley
```

The short model name resolves to the complete versioned Terrain Diffusion
source preset; it does not relabel a synthetic recipe.

The Terrain Diffusion recipe keeps whole-world illustration disabled by
default. `--illustration on` is an explicit experiment and remains fail-closed;
the current FLUX.2 Klein proofs were rejected for semantic drift, invented UI,
and insufficient material richness.

Generated packages are intentionally ignored by Git. A package must validate,
contain an accepted illustrated master, receive hash-bound human approval, and
pass `npm run worldgen:promote` before it can become a selectable standalone
shard. Promotion installs a new immutable ID and never overwrites the default
world; manual copying into runtime paths is not an approved substitute. Full
details are in `docs/world-generation.md`.

Each package also contains deterministic habitat authority, balanced resource
nodes, lifecycle/decay metadata, four landmark compositions, a runtime-shaped
terrain-detail patch, and an ecology review image. Inspect one locally at
`/world-editor.html?package=/worlds/generated/<world-id>`.

Climate recipes declare latitude, prevailing wind, elevation lapse,
seasonality, ocean moisture, orographic lift, water humidity reach, and fog
thresholds. Generated climate authority drives biome/ecology placement and
records four seasonal baselines plus an honest dynamic-weather status.

Every package also emits `chunks/index.json` and independently hash-pinned
`chunks/chunk-X-Y.json` files. Chunk cores cover the world exactly once and
include recipe-sized overlap aprons for seam-safe terrain, climate, and biome
sampling. These are the intended huge-world streaming artifacts; the monolithic
bundle remains a review/provenance and legacy-compatibility surface. Promotion
retains the chunk package. A chunked approved browser session skips that
monolith, assembles a moving 3 by 3 terrain window at global coordinates, and
prefetches through a bounded LRU. Promoted Rust shards reconstruct one bounded
region from the same pinned chunks, rejecting hash, geometry, coverage, byte,
height-range, or shared-vertex drift before binding. Cross-region player
routing/handoff remains a production boundary; chunk-local painted art is
implemented as a fail-closed review pipeline.

Play a validated package without promoting it:

```sh
npm run worldgen:preview -- --package worlds/generated/WORLD_ID --port 4112
```

Preview stages a hash-addressed `review` runtime under `var/world-previews/` and
never modifies approved or live world assets.

Recipe hydrology settings bound tributary count and length, watershed outlet
aggregation, and shoreline classification. Packages record watershed IDs for
every tile, playable tributary paths, lake outlets, and exact shoreline edges;
validation rejects drift between those records and water authority.

The workshop can export a source-hash-bound settlement, trail, and landmark
patch. Replay it through the generator under a new immutable review ID:

```sh
npm run worldgen:apply -- \
  --source worlds/generated/SOURCE_ID \
  --patch PATCH_PATH \
  --id NEW_WORLD_ID
```

The replay command reconstructs the original terrain source, derives planning
and ecology again, records authoring provenance, emits every coordinated LOD,
and validates the result. It never writes to approved or live runtime paths.
