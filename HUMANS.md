# Duskfell For Humans

This is the senior-dev map of the Duskfell PoC. It explains how the code fits
together in plain English. The `AGENTS.md` hierarchy tells future agents what
rules to obey; this file tells humans and agents what the system is doing.

## What This Repo Is

Duskfell is an original dark-age sandbox MMO proof of concept. The browser is a
renderer and input device. The Rust server owns the world, validates mutations,
ticks the simulation, records important events, and hands settlement jobs to an
async boundary that models future Base/$DUSK settlement.

The important invariant is simple:

```text
client sends intent -> server validates and mutates -> server snapshots reality
```

Do not turn the client into an authority for position, resources, inventory,
crafting, decay, ownership, or settlement.

## Repo Map

```text
client/      Browser canvas client: input, protocol parsing, rendering, UI.
server/      Rust server: authoritative sim, runtime, WebSocket, auth, metrics.
assets/      Runtime PNG assets, manifests, generated candidates, provenance.
scripts/     Generators, verifiers, smoke tests, deployment and ops gates.
docs/        Architecture, security, art, terrain, rendering, refactor records.
contracts/   Reserved future Base/$DUSK settlement boundary.
```

Start with `AGENTS.md`, then the nearest child `AGENTS.md`, then this file, then
the topic docs for the surface you are touching.

## Runtime Boot

The entry point should stay boring. `server/src/main.rs` initializes tracing,
asks runtime assembly to build the world, starts the tick loop, builds routes,
binds the listener, and waits for shutdown:

```rust
let runtime = initialize_runtime().await?;
tokio::spawn(run_tick_loop(runtime.state.clone()));

let app = build_router(runtime.state, runtime.assets_dir, runtime.client_dir);

let listener = TcpListener::bind(runtime.addr).await?;
axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
    .with_graceful_shutdown(shutdown_signal())
    .await?;
```

Most startup logic belongs in `server/src/runtime.rs`, not `main.rs`. Runtime
assembly currently handles:

- environment/config parsing and fail-closed public deployment validation
- durable JSONL journal/outbox setup and replay
- world content loading from `server/data/world.json`
- sprite, terrain, and terrain-detail manifest verification
- settlement worker wiring
- `SimWorld` construction
- shared `AppState` construction for routes and WebSocket handlers

If startup gains a new responsibility, ask whether it is runtime assembly,
durable setup, asset verification, content loading, or route wiring. Put it in
the narrowest module that matches.

## Server Authority

`server/src/sim.rs` is the simulation coordinator. It is no longer meant to hold
every gameplay rule. Leaf behavior lives under `server/src/sim/*`:

```text
sim/model.rs              ECS components, constants, shared event shapes
sim/movement.rs           movement validation and terrain/blocker checks
sim/interactions.rs       player interaction dispatch
sim/inventory/*           inventory stacks, lifecycle, compost, snapshots
sim/resources/*           resource nodes, defaults, generated ecology catalog
sim/ecology/*             decay, fallout, mycelium, compost transfer, coils
sim/terrain_authority/*   checked terrain-detail blockers/resources/decay
sim/world_init.rs         world/content bootstrap
sim/snapshot.rs           protocol snapshot projection
```

The tick path shows the intended shape: lifecycle systems advance, resource and
decay systems emit events, movement is computed from player input, and
interactions are attempted only after server-side validation.

```rust
self.advance_resource_lifecycles(dt);
self.advance_inventory_lifecycles(dt);
outcome.resource_node_events.extend(self.regenerate_resource_nodes(dt));
outcome.resource_node_events.extend(self.decay_deadwood_into_mycelium());

let input = self.inputs.get(&player.id).copied().unwrap_or_default();
velocity.x = axis(input.left, input.right) * PLAYER_SPEED * scale;
```

When adding gameplay, keep the mutation server-side and expose only derived
snapshot state to the browser.

## WebSocket Flow

The browser starts with `POST /api/session`, then connects to `/ws?session=...`.
In shared/public modes, session and account checks happen before a player entity
exists. `server/src/ws/connection.rs` owns socket lifecycle:

```rust
sim.add_player_with_identity(player_id, display_name, account_subject.clone())?;
send_welcome(&mut socket, &state, player_id).await?;
send_snapshot(&mut socket, &state, player_id).await?;
```

Text messages are parsed and bounded through ingress helpers. Binary frames are
unsupported protocol traffic. Repeated bad text messages close the socket. Idle
connections close so capacity is not held forever.

Protocol changes cross at least three places:

- `server/src/protocol.rs`
- `server/src/ws/*` or sim snapshot code
- `client/server-message-*.js` plus client protocol tests

## Browser Client

`client/app.js` is the conductor, not the whole app. It wires DOM, assets,
terrain cache, camera, renderers, network callbacks, input, and the animation
frame loop:

```js
const terrainDrawer = createTerrainDrawer({ getTerrain: () => terrainCache.getTerrain() });
const playerDrawer = createPlayerDrawer({ getSprites: () => sprites, playerRenderState });
const networkClient = createNetworkClient({ getInputState, onWelcome, onSnapshot });

runtimeAssets.loadSpriteAssets();
runtimeAssets.loadTerrainAssets();
networkClient.connect();
requestAnimationFrame(draw);
```

`client/network-client.js` sends intent, not state:

```js
const input = {
  type: "input",
  seq: ++inputSeq,
  up: Boolean(state.up),
  down: Boolean(state.down),
  left: Boolean(state.left),
  right: Boolean(state.right),
  interact: Boolean(state.interact),
};
```

Rendering modules should consume snapshots and checked runtime assets. They
should not invent resource amounts, ownership, inventory, crafting results, or
decay state.

## Camera And Rendering Contract

Duskfell uses a disciplined plan-oblique camera, not free-form isometric art.
The durable contract is:

- `military-plan-oblique`
- `64x64` square diamond ground cells
- bottom-center actor anchors
- stable actor scale and facing sets
- coherent terrain footprints without rotated gaps
- depth sorting for players, props, walls, canopies, roofs, and elevation

Relevant files:

```text
client/projection.js
client/camera.js
client/terrain-draw*.js
client/terrain-depth.js
client/player-*.js
client/object-*.js
client/interior-*.js
```

Visual changes should be inspected in the browser. Unit tests catch contracts;
the browser catches bad taste, scale, overlap, and motion.

## Assets And Manifests

Assets are runtime inputs. They are not random images dropped into the repo.
Runtime PNGs are pinned by manifests and checked by both server startup and the
browser loader.

```text
assets/sprites/manifest.json
assets/terrain/manifest.json
assets/terrain/detail-authority.json
scripts/verify-sprite-manifest.js
scripts/verify-terrain-atlas.js
scripts/verify-terrain-detail-authority.js
server/src/runtime_assets/*
client/asset-integrity.js
```

Generated source images, candidates, archives, approved runtime sheets, and
player-card/paperdoll art should stay clearly separated. Clean-room provenance
and review state belong in manifests or nearby README files.

## Terrain And World Depth

Terrain is both visual composition and gameplay authority. The browser draws
height, materials, detail sprites, interiors, occlusion, and depth cues. The
server consumes checked terrain-detail authority for blockers, promoted resource
nodes, and decay consumers.

The current goal is not "more clutter." It is a coherent world:

- sparse readable spaces
- material families and transitions
- elevation that affects visuals and movement constraints
- trees/rocks/ruins with identity, stage, depletion, replenishment, and decay
- interiors where roofs can hide and floors remain understandable

Files to inspect first:

```text
docs/terrain-system.md
assets/terrain/README.md
client/terrain*.js
server/src/terrain.rs
server/src/sim/terrain_authority/*
scripts/generate-terrain-detail-authority.js
```

Huge-world generation is hierarchical. `npm run worldgen:atlas` emits coarse
continental elevation/climate/biome authority plus deterministic descriptors
for every `192 x 128` region. `npm run worldgen:region` validates one descriptor
and refines it into twenty-four `32 x 32` chunks with overlap aprons. Neighboring
regions sample global coordinates and share exact boundary heights. The runtime
promotion path retains those chunks. Chunked approved browser sessions skip the
regional monolith and use a hash-verifying, bounded LRU to assemble moving
terrain windows at global coordinates. Continental drainage supplies shared
flow segments and reciprocal gates to regional refinement. Promoted Rust shards
also omit duplicate monolithic terrain grids and reconstruct one bounded region
from byte- and hash-pinned fixed-point chunks before startup. Manifest-v4
review packages also crop gameplay-resolution controls for every chunk sample
apron, record each core crop, and hash exact RGB overlap bands between
neighbors. Validation decodes the controls and rejects even rehashed one-pixel
seam drift. Accepted illustrated output is cropped into an equivalent visual
set, validated again, and preserved by promotion. Approved clients skip the
gameplay monolith, stream authority and illustrated chunks through independent
bounded LRUs, and compose only the nearby apron-bearing window. Controls remain
generation inputs and are never rendered as approved art.
Recipes may select `illustration.execution: chunked-v1`. That mode records one
resumable, hash-bound img2img job per visual control, uses deterministic
coordinate-derived seeds, creates a pre-reconciliation candidate contact sheet,
and promotes the complete request/response/output provenance tree. Completed
jobs are reused only when their request, control, output bytes, dimensions, and
hashes still match.
`npm run worldgen:regions` adds durable multi-region scheduling over a validated
atlas rectangle. Its atomic `batch.json` pins atlas/template identity and every
accepted region manifest. Resume revalidates completed packages, retries only
incomplete work, caps concurrency at four, and refuses identity or output drift.
`npm run worldgen:preview -- --package PATH --port 4112` revalidates one package
and boots it through the real Rust/client chunk path from an isolated
hash-addressed `review` runtime under `var/world-previews/`. The browser requires
the printed `preview=1` opt-in, and the command does not touch the approved-world
registry or count as visual approval.
Atlas-bound
snapshots expose validated global origin and neighbor IDs, and outward movement
emits a de-duplicated server handoff intent. The server has a bounded player-state
export/import contract plus tested HS256 transfer tickets bound to atlas hash,
source, destination, expiry, and one-use nonce. They are deliberately not wired
to live sockets until a trusted region endpoint registry, source freeze/ack
protocol, and shared durable replay ledger can make the whole handoff atomic.
Coordinated cross-region elevation editing and local tributary curvature/erosion
remain explicit follow-up work. Chunk illustration is independently scheduled
inside each bounded region build. Bounded atlas-region
terrain edits already replay against source-resolution rasters and fail closed
if any generated edge value drifts.

## Settlement Boundary

Settlement is asynchronous. Gameplay must not wait for chain writes.

Current flow:

```text
sim validates deed/resource/craft action
-> journal records gameplay event
-> settlement job is appended to JSONL outbox
-> worker confirms dry-run receipt asynchronously
-> ledger/index exposes pending and confirmed state
```

The future production split is a separate settlement service with signer keys
isolated from the game server. Until that exists, public chain mode must stay
fail-closed.

## Persistence

The PoC uses JSONL as a stepping stone:

- `var/journal.jsonl` for gameplay/ownership audit events
- `var/settlement-outbox.jsonl` for queued/confirmed settlement jobs
- startup replay with byte and line-size ceilings
- optional synced writes through `DURABLE_SYNC_WRITES=true`
- readiness/metrics/admin surfaces for durable health

This is not the final production data store. Production wants Postgres for
accounts, characters, inventory, land, settlement jobs, receipts, and audit
tables; Redis or similar for sessions, hot admission/rate limits, and presence.

## Common Change Recipes

### Add A Gameplay Rule

Touch server first. Add the authoritative state/mutation under `server/src/sim/*`.
Expose derived snapshot fields through `server/src/protocol.rs`. Add Rust tests.
Then update client parsers/rendering and client tests if the player can see it.
Add or update a smoke when the loop matters end-to-end.

### Add A Protocol Field

Update the Rust protocol shape, the snapshot/welcome producer, the browser
normalizer under `client/server-message-*.js`, and tests on both sides. Keep
fields bounded and backward behavior explicit.

### Add Or Promote Art

Keep generated source separate from runtime output. Update the manifest,
provenance, approval status, hashes, and docs. Run the relevant asset verifier.
Inspect in the browser at game scale before calling it approved.

### Change Camera, Projection, Or Actor Facing

Treat this as a project-wide contract change. Read `docs/rendering.md`,
`docs/art-direction.md`, sprite and terrain agent files, client projection/camera
tests, and asset manifests. Do not fix one sprite by quietly changing the whole
world's geometry.

### Change Public Deployment Or Security

Start from `docs/security.md` and server config/auth/admission modules. Preserve
fail-closed behavior. Add or update a smoke script for the negative case, not
only the happy path.

### Split A Large File

Check `docs/refactor-map.md`. Split by ownership boundary, not line count alone.
Move tests with behavior or add focused tests around the new boundary. Avoid
mixing refactor-only moves with gameplay/art changes unless the integration is
the point.

## Verification Ladder

Use the smallest useful proof for the touched surface:

```sh
cargo test -p sundermere-server
npm run test:client
npm run test:sprites
npm run test:terrain
npm run assets:verify
npm run art:direction
npm run verify:local
npm run verify:ci
```

For deployment/security/runtime behavior, run the focused `npm run smoke:*`
script that covers the touched path. If a broad gate is too expensive or blocked,
say exactly what did not run and what risk remains.

## Honest Status

Strong parts:

- server authority and session/admission posture are already production-shaped
- JSONL durability/replay is a good PoC stepping stone
- runtime asset verification is much better than loose image loading
- refactor work has removed the worst god-file pressure
- art pipeline now has manifests, provenance, and review gates

Still not production:

- JSONL/in-memory state must become real durable services before public scale
- Base/$DUSK contract work is a reserved boundary, not live economics
- generated art is still under style review and must beat the current bar
- terrain/world composition needs authored rules, not more random clutter
- client rendering needs continued browser inspection for quality and FPS

The right standard is not "does the demo run?" It is "can another senior dev or
agent make the next change without guessing where reality lives?"
