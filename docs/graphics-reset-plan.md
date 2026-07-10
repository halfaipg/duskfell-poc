# Graphics Reset Plan

Dated decision record, July 9, 2026. This captures the graphics direction reset
agreed during the Blender-pipeline experiments so the reasoning survives
context loss. Read together with `docs/art-direction.md`, `docs/art-pipeline.md`,
and `docs/rendering.md`. Where this conflicts with older pipeline notes, this
document wins until superseded by a newer dated decision.

## Why a reset

The PoC accumulated three unrelated art styles: AI-painted terrain tiles,
AI-generated + procedurally recolored character sheets, and procedural canvas
effects. AI one-shot *animation sheet* generation failed structurally
(frame-registration drift, detached limbs, matte residue — see the July 8
sheet audits) and is retired. The first asset that "gleamed" was a 3D-rendered
character (Blender + MPFB), because light, material, and form came from one
system.

## The one rule

Player-visible art should come from, or be normalized through, **one Blender
world-kit**: one sun direction, one ortho camera contract (military plan-oblique
with shear where architecture needs it), one pixel density, one final
quantize/palette pass. Coherence is a property of the pipeline, not a
post-hoc fix.

The projection contract itself does not change: `military-plan-oblique`,
1:1 diamonds, 64px tiles, `zPx=6` (`client/projection.js`). All existing
manifest/SHA/provenance gates stay.

## Source policy by asset class

| Asset class | Source | Notes |
| --- | --- | --- |
| Character bodies | MPFB2 parametric humans in Blender | CC0 by construction; body types are macro sliders (gender/age/muscle/weight/height) |
| Character animation | Rigged MPFB skeleton, retargeted CC0 clips, batch-rendered | Never AI sheet generation |
| Equipment/paperdoll | Conforming clothes meshes on the same rig (MPFB assets or modeled) | Perfect frame registration for free |
| Tattered/organic cloth | Procedural sculpted-drape geometry (see wretch prototype) | Parameterized: tears/folds/length are seeds, not art tasks |
| Terrain tiles | **Hybrid, pending comparison verdict** — see below | Same 72-frame atlas contract either way |
| Props/objects (buildings, trees, shrines, gates) | **AI generation stays** — the `duskfell-props` sheet quality was liked and approved | Static frames only; provenance-gated as today |
| Item icons, portraits/player cards, concept art | AI generation (grid/ComfyUI recipes) | Static images; AI's strong suit |
| Ground decals (footprints, scorch, wear) | Blender-rendered decal sprites | New layer, see below |
| Textures/materials | Poly Haven CC0 (via blender-mcp) + AI source textures | Both acceptable inputs to the world-kit |

## Terrain: the comparison

Artifact: `assets/terrain/candidates/terrain-comparison-board.png`
(3D renders: `render3d-{grass,transition,dirt}.png`, same directory).

Method: current AI-painted atlas tiles (grass/dirt flat-base + dirt→grass
pair-transition, tiled 3x3) vs. 3-tile ground patches rendered top-down in
Blender using Poly Haven CC0 PBR materials (`brown_mud_leaves_01`,
`brown_mud_dry`), displacement geometry, and the same sun direction as the
character renders, quantized to 64px/tile.

Honest reading of the first round:

- **AI atlas wins**: lushness of the grass base material; already tuned to the
  game's palette.
- **3D wins**: transitions (organic noisy boundary vs. hard strip), zero
  visible tiling repetition, physically consistent lighting shared with
  characters, and slope shading would be real instead of painted.
- **3D loses so far** only on material selection (first-round textures read
  "trampled moor," not "grass") — a texture-choice problem, not a pipeline
  problem.

Working conclusion (pending final call): **hybrid terrain** — AI-painted or
AI-sourced *base material* textures where they read better, fed into the 3D
world-kit as material inputs, with transitions/slopes/lighting rendered in 3D.
The 72-frame atlas contract (flat/slope/edge/corner/pair slots) is unchanged;
only how the pixels are produced changes.

### July 9 img2img sandwich experiment (round two)

Artifact: `assets/terrain/candidates/terrain-fourway-board.png`
(inputs/outputs: `render3d-transition.png`, `img2img-sandwich.png`,
`txt2img-control.png`).

Method: the pure 3D transition patch was passed through AI Power Grid img2img
(`FLUX.2 Klein 4B FP8`, seed 7341, whole-patch, via the `grid` skill at
`~/.claude/skills/grid/SKILL.md`; auth via `GRID_API_KEY` env var — key not
committed) against a pure txt2img control with the same prompt/seed.

Findings:

- **The sandwich works.** img2img over the whole 3D patch preserved the exact
  boundary position/shape defined by the 3D mask (so sliced tiles still honor
  the atlas contract and tile with neighbors) while adding genuine richness —
  individual grass blades, pebbles, soil texture.
- **The control shows the target look** (hand-painted game-art quality, grass
  ledge overhanging dirt) but its boundary is uncontrolled: untileable,
  cannot fill contract slots. It is a style reference, not a pipeline.
- Gaps to tune: sandwich output is darker/more muted than the current atlas;
  push style descriptors in the prompt (or a curated grid style preset) to
  move C toward D's look while keeping structure.
- **CORRECTION (July 9 parameter study,
  `assets/terrain/candidates/img2img-parameter-study.png`): the grid DOES
  accept a `strength` param** (maps to denoise), gated to **0.55–0.95** on
  FLUX.2 Klein 4B FP8. Lower = closer to source structure with gentler
  embellishment; 0.95 = heavy reinvention (layout drifts, features move).
  All prior session outputs used the service default (~0.8 look). Other
  gates on this model: `steps` 4–6 (visually near-identical across the
  band), `cfg_scale` 1.0–1.5 (1.5 slightly punchier). Practical recipe:
  structure-critical passes (borders, contract masks) at strength 0.55–0.65;
  style-explorations at 0.8+; steps/cfg mostly noise, leave default.

**Adopted terrain pipeline: 3D bake (continuous multi-tile patch, world-space
noise, contract masks) → one whole-patch img2img enrichment pass (governed
recipe: pinned model/seed/prompt) → slice into 64px atlas slots → quantize →
manifest/SHA intake.** AI never sees a tile edge; 3D never has to be pretty
alone. Animation frames remain excluded from img2img (per-frame drift).

### July 9 river showcase (three materials, real height)

Artifacts: `assets/terrain/candidates/river-bake-3d.png` (structure pass),
`river-sandwich-{0,1}.png` (enrichment, seeds 7341/20177 — 20177 selected),
`river-progression.png`, `river-scene-mockup.png` (military-view scene with
unified props/player).

The bake used real displaced geometry: an S-curve river channel carved into a
heightfield, a **flat water plane whose intersection with the channel produces
the shoreline** (organic by construction — no painted mask), and a mountain
rise on one side, with materials blended by height (mud below waterline →
grass mid-band → rock above) plus world-space noise. The img2img pass kept the
exact river course, shorelines, and cliff line while adding ripples, submerged
stones, pebble beaches, grass tufts, wildflowers, and cliff ledges.

Notes for production: height-based material splatting + intersection
shorelines should be the standard bake technique for all water/elevation
transitions; the same heightfield that shapes the bake can be exported for the
server's walkability/step-height authority so visuals and collision stay one
source of truth.

### July 9 scale doctrine (two-LOD enrichment)

Lesson from the alpine renders: img2img reinterprets scale freely — painted
"crags" became mountain *ranges*, so a 1.8m player composited at tile scale
read as a giant. Fix that worked (`ground-level-meadow.png`,
`player-view-ground.png`): **two-LOD enrichment**. LOD0 = region map (one
bake+sandwich covering a large area; scale ambiguity is fine, it's a map).
LOD1 = crop a local patch of the region image and run a *second* img2img pass
with a ground-level prompt ("individual grass tufts, pebbles, walking-height
scale, no mountains") — the crop's colors/layout anchor the composition, the
prompt pins the scale, and the output is the actual playfield ground at
UO-like proportions (tufts knee-high, boulders torso-high vs a 1.8m ≈
112px player). Production tiles slice from LOD1 patches, never from LOD0.
Every ground-LOD prompt must state the scale explicitly; "no mountains, no
cliffs" belongs in ground-LOD negative space.

### July 9 biomes + borders (style variants are palette swaps)

Artifacts: `assets/terrain/candidates/biome-catalog.png` (8 named biomes),
`biome-border-board.png` (5 border pairs in military view),
`biome-border-method.png` (proof strip), `style-*.png` (single-biome patches),
`border-*.png` (healed border patches).

Biomes are **prompt swaps over the same bake** — all catalog patches came from
one LOD1 ground crop with one pinned seed (20177), only the style descriptor
changed. Working biome set (names provisional): Heartland Meadow (painterly —
the base language), Autumn Heath, Chalk Downs, Frostfell, Fenmarsh, Dark Moor,
Ashlands, Cursed Blight.

**Border method (validated):** paste biome patch B over biome patch A along an
organic value-noise mask (feathered ~36px), then run ONE img2img healing pass
whose prompt names both biomes and asks for "fingers of each biome reaching
into the other." The mask defines WHERE the border is; the heal defines HOW it
looks. Verified with a mask-centerline overlay: the healed boundary tracks the
mask (`biome-border-method.png` panel 3), so the same mask can drive the
engine's tile classification — every 64px slice knows whether it's pure-A,
pure-B, or which pair-transition slot it fills, straight from mask coverage.
Because all biome patches share the bake, features align across the seam
before healing even starts. Script:
`scratchpad/build-border-composites.py` (session scratchpad — promote to
`scripts/` when the atlas slicer lands).

**Gradual ecotones (v2, preferred):** the first-round line borders (~0.5 tile
feather) read as edges, not places. v2 widens the mask into a ~3–4 tile
ecotone: mid-frequency value noise perturbs the signed distance to the
centerline (`border_mask_gradual`: wander 140, feather 64, patch_amp 170), so
the 50% line grows fingers and detached islands of each biome inside the
other, and the heal prompt asks for "scattered patches and tongues of each
biome, thinning out with distance, no sharp boundary line." Artifacts:
`biome-border-board-gradual.png`, `border-*-gradual.png`. Engine implication:
an ecotone spans several tile rows — mask coverage per 64px slice classifies
each tile as pure-A, mixed (which pair-transition slot), or pure-B, exactly as
before, just across a wider band.

**Snow border lesson (v4):** alpha-feathered snow reads as fog — snow is
binary, not translucent. Fix that worked
(`border-meadow-frostfell-gradual.png`, `border-frostfell-fix.png`): hard
threshold mask (feather ~12) AND a painted **shadow rim** along each snow-patch
edge in the composite (mask FIND_EDGES → offset (3,4) → multiply blue-grey)
before healing, with a prompt describing "solid raised layer with a sharp edge
and a soft blue-grey shadow along its rim, no fog/haze/mist." The rim cue is
what makes the model paint drifts as a thick layer instead of a fade.
General principle: when a material has a physical edge (snow, water, sand
drifts, lava crust), draw the edge cue INTO the composite — the heal pass
amplifies cues, it doesn't invent physics.

**Three-band borders (v5, adopted for hard-material pairs):** two-patch
blending still jumped grass→snowfield too fast. Fix: generate the transition
zone as its OWN patch — a "melt fringe" (thin patchy snow on grass, wet bare
earth, prompt-generated from the same ground crop/seed:
`border-band-snowfringe.png`) — then composite three bands (meadow → fringe →
deep snow) across two masks and heal once. Result:
`border-meadow-frostfell-gradual.png` (v5). The fringe patch doubles as its
own tile set (thin-snow ground for high-altitude/winter areas). Rule of thumb:
biome pairs that intergrade (grass↔marsh) can two-patch blend; pairs separated
by a material phase change (snow, water, lava) need an authored middle band.

**Water shoreline via three-band (July 9, demo-validated):** meadow → wet-sand
shore band → open water, with a dark wet rim drawn on the sand side of the
waterline (same edge-cue trick as snow) and a heal prompt asking for "crisp
waterline with a thin broken white foam edge." Result:
`border-meadow-water-gradual.png` — foam lines, caustic shallows with
submerged pebbles, deep-water falloff. Band patches: `/tmp`-generated water +
wet-sand from the standard ground crop/seed. Used in the shore-run demo
(`assets/demos/shore-run-demo.html`, `shore-run-demo.gif`) where the run path
follows the probed waterline (windowed-min so the path never corner-cuts
through bays). Water remains bake-level (intersection shorelines) for real
maps; this validates the *look* and the border tiles.

**Three-band promoted to the standard border recipe (user-approved on the
snow pair, then applied everywhere):** all five border pairs rebuilt with
authored middle bands — soggy ground (meadow→fen), scorched fringe
(meadow→ash: dry yellowed grass, ash dust, charred stubble), thinning chalk
(meadow→chalk), melt fringe (meadow→frost), sickening land (fen→blight:
wilted grey vegetation, first violet veins). Board:
`biome-border-board-3band.png`; healed patches `border-*-gradual.png`; band
patches `border-band-*.png` (each band is generated from the same ground
crop/seed 20177 and is usable as a standalone tile set — border bands are
free biome variants). Composite geometry: two masks at cx≈0.34/0.70, wander
100, feather 26 (organic pairs) or 12–14 (phase-change pairs), patch_amp 120,
heal seed 31007. Middle bands also give the world design vocabulary:
scorched fringe = "you are approaching ashlands" readable at a glance.

Production shape: per biome pair the atlas contract needs edge/corner/pair
slots; generate them by sliding the SAME contract masks (straight edge,
outer/inner corner) through this composite→heal pipeline instead of the
freeform demo mask. In-engine, the server's biome map picks tiles; borders are
just tiles whose mask happened to be a contract shape.

## Ground layer architecture (footsteps etc.)

Render layers, bottom to top:

1. **Terrain base** — chunk-cached static tiles (exists).
2. **Wear decals** — persistent: worn paths, campfire scorch. Candidate tie-in:
   ecology/terrain-detail authority could emerge paths where players walk.
3. **Transient decals** — footprints, scuffs, drips. Blender-rendered decal
   sprites (e.g. boot impressions, ~5 variants) stamped at footfall position +
   walk direction, alpha-fade over seconds. Hook exists:
   `client/player-footstep-effects.js` already receives footfall pulses from
   the walk sampler.
4. **Ecology ground effects** — exists (`client/ecology-ground-effects.js`).
5. **Entities** — depth-sorted actors/objects (exists).
6. **Overhead/roofs** — interior occlusion (exists).
7. **Light/tint pass** — day/night tint, torch radii. Blocked on Canvas 2D
   chunk cache; natural first win of a PixiJS migration.

## Fluid motion doctrine (July 9, 2026)

Question raised: should the game move to real-time "fluid motion graphics"
(a 3D client)? Decision: **no — fluidity and resource-weight are separate
axes.** Perceived fluidity comes mostly from smooth positional interpolation,
not animation frame count (reference: Stardew's 4-frame walks feel fluid
because position/camera/effects glide at 60fps). The low-resource identity
(browser canvas, sprite blitting, runs on weak hardware) is an explicit
product goal and a differentiator; a real-time 3D client would trade it away
and force faking the military projection with a sheared camera at runtime.

The cheap path to fluid feel, in order of bang-for-buck:

1. **Client-side interpolation** — tween entities between authoritative server
   positions; camera eases instead of snapping. Zero new assets, zero GPU.
   This is most of "fluid."
2. **Richer sprite sheets from the Blender factory** — 12–15 frames per walk
   cycle instead of 8. Costs offline render time only; a full character
   (8 dirs × 15 frames × 128px) is a few MB of atlas. Runtime cost unchanged.
3. **Ambient life in layers** — footstep decals, ecology grass sway, cloth
   flutter baked into frames by the rig. Reads as "alive" with no engine
   change.

## Character sprite contract (facing + pose)

The composited player sprite (duskfell-uo-wretch-game-angle-sw) is a loose
A-pose from an arbitrary camera — it never fully "sits" in the world. The
contract to fix it (next factory step):

- **8 facings** at 45° increments (S, SW, W, NW, N, NE, E, SE in screen
  space), rendered by rotating `wretch_root`, camera fixed. Because terrain
  is a 45°-rotated plan, a character walking screen-down faces world-SW; the
  factory maps rig yaw → screen facing accordingly.
  **Verified mapping** (camera at -Y, MPFB faces -Y at rest): root yaw
  **+45° = screen down-right (SE)**, -45° = screen down-left (SW); a first
  render shipped mirrored (user caught sprite facing opposite its motion) —
  always eyeball facing against motion direction before compositing.
  Movement along world +v maps to screen down-right; +u maps to screen
  up-right.
- **Camera**: orthographic, elevation ≈ 55–60° (UO-like read), matching the
  world-kit sun. One camera for all frames of all characters — frame
  registration is a rig property, not an art task.
- **Pose**: relaxed idle (arms adducted to sides — upperarm x≈-16 was the
  validated relaxed value, feet under hips, slight asymmetry); walk cycle as
  keyframed thigh/calf/arm counter-swing on the MPFB rig.
- **Scale**: 1.8m ≈ 112px at 64px/tile (two-LOD doctrine); render at 2x and
  downsample with the unifier quantize for the pixel-art read.

## Mockup composition recipe (for boards/screenshots)

Validated pattern for military-view mockups from a 1024 terrain patch:
resize to 12 tiles × 64px = 768px, quantize(96), `rotate(45, expand,
NEAREST)`; plan→military coords via rotation by -45° around the center
(y-down). Sprite: crop alpha bbox, scale to 112px height at half-res LANCZOS,
quantize(48), alpha threshold 96, NEAREST 2x upscale. Tone-unify every panel:
Color 0.82, Brightness 0.94, multiply (243,236,226). **Never place the player
by eye — probe the terrain pixels** (green-dominant check) for standable
ground first; img2img moves water/features (learned twice: giant-on-mountain,
player-on-pond).

## Renderer

Stay Canvas 2D until a concrete wall (lighting pass, entity count), then
migrate to **PixiJS v8** (WebGPU/WebGL), porting the projection/camera/sort
contracts unchanged. Do not build a custom renderer. Do not build a real-time
3D client — 3D is an *offline sprite factory* only. If a 3D client is ever
revisited, military projection is achievable with a sheared orthographic
projection matrix (top-down ortho + z→screen-y shear; depth along
`v = (1, 1, 2c/k)`), not with any stock camera pose.

## What dies / lives

- **Dies**: ComfyUI *sheet* generation scripts (quarantine to `legacy/`),
  procedurally recolored actor sheets + deterministic equipment overlay
  placeholders ("bucket jackets"), current AI walk-sheet assets once factory
  sheets land.
- **Lives untouched**: Rust server, projection math, manifest/SHA gates,
  terrain atlas format, terrain-detail authority, ecology sim.
- **Demoted, not dead**: AI generation → props, icons, portraits, textures,
  concepts (see table above).

## Infrastructure notes (July 9, 2026)

- **blender-mcp** installed: addon in Blender 5.1.2 (auto-start:
  `Blender --python-expr "import bpy; bpy.ops.blendermcp.start_server()"`),
  MCP server registered with `UV_CACHE_DIR=~/.cache/uv-claude` (system
  `~/.cache/uv` is root-owned; fix with `sudo chown -R j:staff ~/.cache/uv`).
  Poly Haven integration enabled via scene property.
- **MPFB2** (build 20260613) installed as Blender extension from
  extensions.blender.org. GPLv3 tooling, CC0 bundled assets, generated
  characters are CC0.
- **MakeHuman CC0 asset packs** installed to the MPFB user data dir
  (`.../Blender/5.1/extensions/.user/blender_org/mpfb/data`):
  `makehuman_system_assets`, `skins01`, `shirts01`, `pants01`, `skirts01`,
  `hair01` — all the explicit `_cc0.zip` variants. Any future pack must use
  the `_cc0` variant or pass license review.
- **Blender Studio human base meshes** (CC0) cached at
  `var/third-party-model-candidates/blender-studio-human-base/` (unrigged
  sculpting bases; superseded by MPFB for characters but useful as reference).
- **Prototype scripts**: `scripts/blender-darkage-base-bodies.py` (Blender
  Studio bodies + procedural rags, deterministic batch render). The wretch
  character (MPFB body, rigged `uo_wretch.rig`, sculpted-drape tattered
  shorts, casual pose) currently lives in the interactive Blender session;
  factory-izing it into a headless script is the next pipeline step.
- **Prototype artifacts**: `assets/sprites/player-cards/candidates/`
  (`duskfell-darkage-base-bodies-*`, `duskfell-mpfb-dressed-cast.png`,
  `duskfell-uo-wretch-*`), `assets/terrain/candidates/`.

## Gameplay note

Gameplay redesign is a separate session, but one decision is locked because it
compounds with the art reset: **commit to a day/night cycle**. It motivates
the light/tint layer, gives the ecology a rhythm, and "survive until dusk" is
the cheapest reachable fun loop.

## Engine integration (July 9 — LANDED, first real-engine screenshots)

The painterly art now runs in the actual engine (Rust server + live client):

- **Terrain atlas**: `terrain-placeholder.png` rebuilt by the scratchpad
  `build-painterly-atlas.py` — same 10×12×64 contract, tiles cut from the
  biome patches (`SOURCES` map: grass=meadow, field=autumn heath, dirt=
  painterly bare earth, stone/settlement=chalk downs, water/cobble=shoreline,
  rock=ashlands, ruin=cursed moor, shore=wet-sand band), made repeatable via
  offset-wrap + blended-seam repair. Transition rows use **soft noisy alpha
  ramps** (edges: linear fade; corners: radial fade; pairs: organic noise
  mask) instead of the stock generator's hard triangle masks — the stock
  `normalize-generated-terrain-atlas.py` marks/masks produced harsh
  checkering over painterly art (first-boot screenshot proved it). Promote
  this script into `scripts/` and wire to `terrain:generate` when adopted.
- **Player sheet**: `assets/sprites/duskfell-wretch.png` — engine-native
  8×4 grid of 128px cells, 4 directions (S/E/N/W = rig yaw 0/90/180/-90),
  frame 0 idle + 7 walk phases (t=(i-1)/12), registered by PHYSICAL mapping
  (ortho 2.4m/512px → 112px per 1.8m; feet at anchor 64,116 computed, not
  eyeballed). Manifest block cloned from duskfell-body-base, method
  `deterministic-local`, scale 0.9. Client prefers it via
  `PREFERRED_PLAYER_SHEET_IDS` in `client/player-config.js`.
- **Client shading retune**: `client/terrain-draw-surface.js` facet/height
  shade alphas roughly halved — they were tuned for dark procedural tiles
  and read as heavy dark diamonds over brighter painterly ground.
- **Screenshot harness**: headless Chrome against the live server —
  `Google Chrome --headless=new --screenshot=... --virtual-time-budget=15000
  --user-data-dir=<fresh> http://127.0.0.1:4107/` (fresh profile avoids
  stale-asset cache). Server: `cargo run -p sundermere-server`.
- **Known remaining**: props/buildings read small vs the 1.8m player (prop
  scale pass pending — props were already slated for regeneration); field
  material could use a more distinct texture; walk cycle is first-pass.

Key art (grid, `assets/concept-art/`): `duskfell-keyart-moor-march.png`
(poster), `duskfell-keyart-outpost-dusk.png` (img2img over a real engine
screenshot — doubles as the art target for the future light/tint pass).

## Continuous ground-patch layer (July 9 — the fix that made in-engine match the boards)

Per-tile repeating 64px patterns can NEVER look like the healed biome
patches — repetition destroys the painting (user: "repetitive noise chaos").
New client feature: `client/terrain-ground-patches.js` draws 1024px plan
patches (16 tiles) world-anchored UNDER the tile pass, transformed
`ctx.transform(0.5, 0.5, -0.5, 0.5, anchor)` (45° rotation + 1/√2 scale =
exact military tile grid). Chunks (8×8 tiles) clip the patch to their tiles
of each patched material; a 16-tile supertile hash picks the variant so the
painting is continuous across chunks. Patched materials (grass, field, dirt,
settlement) skip their per-tile palette/underpaint/atlas fill in
`terrain-draw.js`; texture is draped in screen space across elevation (facet/
height shading + side walls carry depth). Patched-pair transition overlays
are skipped (`terrain-draw-atlas-transitions.js`) — blending lives in the
painting. Patch PNGs: `assets/terrain/ground-patches/*.png` (from the biome
patches; **not yet SHA/manifest-gated — add a gate before shipping**).

Hard-won gotchas: (1) supertile-anchored FULL-image draws with 1 plan px
overlap kill bilinear edge-bleed seam lines; (2) never include a pond in a
ground patch — worldgen roads/plazas sample arbitrary patch regions (the
plaza turned teal); (3) pale diagonal "scratch" lines were worldgen ROADS
(1-tile settlement lines) wearing the too-white chalk texture — settlement
needed its own toned patch, not brightness tweaks; (4) `ground-level-meadow`
tufts read as agave at tile scale — patch sources must be feature-scale
matched (~64px/tile density), or content-halved by downscale+mirror-tile.
Round two (same day): ALL ground materials except water now have patches
(rock=dark moor — ashlands' ember cracks read as lava, ruin=cursed moor,
stone/settlement=toned chalk, shore=wet sand, cobble=gravel); patches are
2048px sharpened (LANCZOS 2x + UnsharpMask r2.2/130%) which fixed the "blurry
af" read; one variant per material, alternating supertiles MIRROR the
painting (flipX/flipY by supertile parity) so borders match exactly — two
different crops of the same painting still clash, mirrors don't. field/grass
derive from the same painting (tint shift) so their borders are tonal drift.
Old prop/detail sprites are hidden behind `HIDE_WORLD_PROPS = true` in
`client/object-draw.js` (user retired them pending world-kit prop pass —
players only). Water stays atlas (shimmer decals need per-tile draw).
Remaining known: worldgen speckles small field/dirt blobs whose clip borders
still read hard (needs either worldgen smoothing or feathered patch edges);
facet shading on hillsides still diamond-y. Facet/height/relief shading and
elevation-ridge strokes retuned way down for the brighter art
(terrain-draw-surface.js).

### July 9 follow-up: larger world, eight-biome runtime proof, and symmetry rejection

The demo world is now `96x64` tiles (`6144x4096` world units) with a centered
safe zone and distributed landmarks/resources. Eight 2048px WebP biome sources
are declared in `assets/terrain/manifest.json`, verified by the browser, Node
asset verifier, HTTP smoke, and Rust startup, and blended in soft deterministic
territories. Canvas composition is bounded to four active biome layers and four
cached 2048px composites; elevation draping uses projected triangles instead
of painting a flat screen-space sheet.

This is a better proof, not the final renderer. Mirroring adjacent supertiles
is now explicitly rejected because the bilateral repetition is visible. The
production target remains PixiJS/WebGL material splatting: shared authored
biome weights, two or three local material layers, stochastic non-mirrored
sampling, height/normal-aware transitions, chunk streaming, and bounded GPU
texture caches. The current Canvas path remains a removable compatibility
fallback.

The Blender/img2img terrain sandwich is reproducible again through
`scripts/art-reset/blender-terrain-structure.py` and
`scripts/art-reset/grid-img2img-proof.mjs`. The model bakeoff in
`assets/terrain/candidates/proof-structure-model-bakeoff.png` confirms that
Grid FLUX gives the strongest stylization while the OpenAI native edit best
preserves structure. Neither output can become geometry authority: Blender
height/material masks must be reapplied and boundary drift gated before intake.
`assets/demos/terrain-sandwich-live.html` is the playable review surface: it
uses the Wretch sheet, blocks movement against the Blender water authority,
switches local Grid/native enrichments live, and crossfades to the preserved
alpine LOD0 regional painting when the camera pulls back.

## Build order (updated July 9, post biomes/borders)

1. Walk cycle + 8-facing renders on the rigged wretch (per the character
   sprite contract above) → fluid-motion demo (interpolated movement over the
   border terrains) → first factory sprite sheet.
2. Atlas slicer: cut the healed 1024 patches (`border-*-gradual.png`,
   `style-*.png`) into 64px tiles classified by mask coverage → drop into
   live atlas slots behind the existing verifier.
3. Client-side interpolation (entities + camera easing) — most of "fluid."
4. Footprint decals through the existing footfall hooks (layer 3 above).
5. Unifier quantize/palette pass applied to all asset classes.
6. Props round two (current AI props disliked — regenerate through the
   world-kit or 3D blockout + img2img with the muted palette).
7. Gameplay session (separate) + day/night groundwork.
8. PixiJS migration when the lighting pass demands it.

## Open decisions (user)

- Biome cut: which of the 8 catalog biomes ship first (Heartland Meadow,
  Autumn Heath, Chalk Downs, Frostfell, Fenmarsh, Dark Moor, Ashlands,
  Cursed Blight).
- Lock painterly ("Heartland Meadow" board-1 style A) as the base art
  language — provisionally treated as chosen; biomes are palette swaps of it.
